"""arXiv HTML path: LaTeXML cleanup and page mapping through the PDF."""

from __future__ import annotations

import hashlib

import urllib.request
from pathlib import Path

import pypdf
import pytest
from conftest import CACHE, fixture_pdf, manifest_fixtures
from helpers import assert_docs_consistent, assert_schema_valid, norm

from citegeist_convert import convert

MINI = """<!DOCTYPE html><html><head><title>A Small Paper</title></head><body>
<article class="ltx_document">
<h1 class="ltx_title ltx_title_document">A Small Paper</h1>
<div class="ltx_authors"><span class="ltx_personname">Ada Lovelace</span></div>
<div class="ltx_abstract"><h6 class="ltx_title ltx_title_abstract">Abstract</h6>
<p class="ltx_p">We study <math class="ltx_Math" alttext="x^{2}+y^{2}" display="inline"><semantics><mi>x</mi></semantics></math> sums.</p></div>
<section id="S1" class="ltx_section"><h2 class="ltx_title ltx_title_section"><span class="ltx_tag ltx_tag_section">1 </span>Intro</h2>
<div id="S1.p1" class="ltx_para"><p id="S1.p1.1" class="ltx_p">First paragraph<span class="ltx_note ltx_role_footnote"><sup class="ltx_note_mark">1</sup><span class="ltx_note_outer"><span class="ltx_note_content"><sup class="ltx_note_mark">1</sup><span class="ltx_note_type">footnote: </span>A footnote text.</span></span></span> continues here.</p></div>
<table id="S1.E1" class="ltx_equation ltx_eqn_table"><tbody><tr class="ltx_equation ltx_eqn_row"><td><math alttext="\\displaystyle E=mc^{2}" display="inline"><semantics><mi>E</mi></semantics></math></td><td><span class="ltx_tag ltx_tag_equation">(1)</span></td></tr></tbody></table>
<section id="S1.SS1" class="ltx_subsection"><h3 class="ltx_title ltx_title_subsection"><span class="ltx_tag ltx_tag_subsection">1.1 </span>Detail</h3>
<ul class="ltx_itemize"><li class="ltx_item"><span class="ltx_tag ltx_tag_item">&#8226;</span><div class="ltx_para"><p class="ltx_p">Item one</p></div></li></ul>
</section>
<figure id="S1.T1" class="ltx_table"><figcaption class="ltx_caption"><span class="ltx_tag ltx_tag_table">Table 1: </span>Results.</figcaption>
<table class="ltx_tabular"><tbody><tr class="ltx_tr"><th class="ltx_td">A</th><th class="ltx_td">B</th></tr><tr class="ltx_tr"><td class="ltx_td">1</td><td class="ltx_td">2</td></tr></tbody></table></figure>
</section>
<section id="bib" class="ltx_bibliography"><h2 class="ltx_title ltx_title_bibliography">References</h2>
<ul class="ltx_biblist"><li id="bib.bib1" class="ltx_bibitem"><span class="ltx_tag ltx_tag_bibitem">[1]</span>
<span class="ltx_bibblock">J. Doe</span><span class="ltx_bibblock">A Study of Things</span>
<span class="ltx_bibblock">Journal of Stuff, 2019. <a href="https://doi.org/10.1000/abc123">doi</a></span></li></ul></section>
</article></body></html>"""


def test_latexml_cleanup_without_pdf(tmp_path):
    src = tmp_path / "paper.html"
    src.write_text(MINI)
    out = tmp_path / "derived"
    m = convert.run(
        {"sourcePath": str(src), "source": "0123456789ab", "outDir": str(out), "kind": "arxiv-html"}
    )
    assert m["path"] == "arxiv" and "no-pdf-for-page-mapping" in m["flags"]
    o = assert_schema_valid(out)
    assert_docs_consistent(o)
    by_type = {}
    for b in o["blocks"]:
        by_type.setdefault(b["type"], []).append(b)
    assert by_type["title"][0]["text"] == "A Small Paper"
    assert "Ada Lovelace" not in " ".join(b["text"] for b in o["blocks"])
    assert any("$x^{2}+y^{2}$" in b["text"] for b in by_type["paragraph"]), "inline math becomes $latex$"
    eq = by_type["equation"][0]
    assert eq["latex"] == "E=mc^{2}"
    foot = by_type["footnote"][0]
    assert foot["flow"] == "notes" and foot["text"] == "A footnote text."
    assert not any("footnote" in b["text"] for b in by_type["paragraph"]), "footnotes leave the paragraph"
    assert [h.get("sec") for h in by_type["heading"]] == [None, "1", "1.1", None], "printed section numbers"
    assert by_type["paragraph"][1]["sec"] == "1"
    assert by_type["table"][0]["text"] == "A | B\n1 | 2" and by_type["table"][0]["html"].startswith("<table")
    assert by_type["list-item"][0]["text"] == "Item one"
    ref = o["refs"][0]
    assert ref["doi"] == "10.1000/abc123" and ref["year"] == "2019" and ref["title"] == "A Study of Things"


# ------------------------------------------------------------------- real papers (network, cached)

ARXIV = {f["id"]: f for f in manifest_fixtures() if f.get("arxivId")}


def arxiv_html(fid: str) -> Path:
    fx = ARXIV[fid]
    path = CACHE / f"{fid}.html"
    if not path.exists():
        url = f"https://arxiv.org/html/{fx['arxivId']}{fx['arxivVersion']}"
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "citegeist-fixtures/0.1 (test corpus)"})
            with urllib.request.urlopen(req, timeout=60) as r:
                path.write_bytes(r.read())
        except Exception as e:  # noqa: BLE001
            pytest.skip(f"arXiv HTML unavailable (offline?): {e}")
    return path


@pytest.mark.network
@pytest.mark.parametrize("fid", ["arxiv-2310.06825-mistral-7b", "arxiv-2312.00752-mamba"])
def test_arxiv_html_with_page_mapping(fid, tmp_path):
    pdf = fixture_pdf(fid)
    html = arxiv_html(fid)
    out = tmp_path / "derived"
    m = convert.run(
        {
            "sourcePath": str(html),
            "source": hashlib.sha256(html.read_bytes()).hexdigest()[:12],
            "outDir": str(out),
            "kind": "arxiv-html",
            "pdfPath": str(pdf),
        }
    )
    o = assert_schema_valid(out)
    assert_docs_consistent(o)
    assert m["path"] == "arxiv" and "page-mapping" in m["tools"]
    blocks = o["blocks"]
    pages = [norm(p.extract_text() or "") for p in pypdf.PdfReader(str(pdf)).pages]
    assert len(o["pages"]["pages"]) == len(pages)
    assert [p["label"] for p in o["pages"]["pages"]][:3] == ["1", "2", "3"]

    # Headings: the heading text must occur on the page they were mapped to.
    heads = [b for b in blocks if b["type"] == "heading" and len(norm(b["text"])) >= 8]
    hit = sum(1 for b in heads if norm(b["text"])[:30] in pages[b["spans"][0]["page"]])
    assert hit / len(heads) >= 0.9, f"{hit}/{len(heads)} headings on the right page"

    # Paragraphs: the first math-free 30 characters occur on the mapped page (or the next one, for page-spanning blocks).
    # Paragraphs whose opening cannot be found in the PDF text at all (cross-reference links) are not verifiable.
    paras = [b for b in blocks if b["type"] == "paragraph" and "$" not in b["text"][:60] and len(norm(b["text"])) >= 40]
    verifiable = [b for b in paras if any(norm(b["text"])[:30] in t for t in pages)]
    ok = sum(1 for b in verifiable if norm(b["text"])[:30] in pages[b["spans"][0]["page"]])
    assert len(verifiable) >= 0.8 * len(paras)
    assert ok / len(verifiable) >= 0.95, f"{ok}/{len(verifiable)} paragraphs on the right page"

    # Spans of a block that crosses a page break are consecutive and cover the whole text.
    for b in blocks:
        assert b["spans"][0]["start"] == 0 and b["spans"][-1]["end"] == len(b["text"])
        assert [s["page"] for s in b["spans"]] == sorted(s["page"] for s in b["spans"])
    assert o["refs"], "bibliography becomes refs.jsonl"
    if fid.endswith("mamba"):
        assert sum(1 for b in blocks if b["type"] == "equation" and b.get("latex")) >= 8
        assert len(o["refs"]) >= 100
    # The mapped pages spread over the whole document, not only the first page.
    assert len({b["spans"][0]["page"] for b in blocks}) >= len(pages) * 0.8
