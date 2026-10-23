"""Web article path: trafilatura, same block model, no pages."""

from __future__ import annotations

import pytest
from helpers import assert_docs_consistent, assert_schema_valid

from citegeist_convert import convert
from citegeist_convert.errors import ConvertError

PAGE = """<!doctype html><html lang="en"><head><title>On Reading Slowly - Example Journal</title>
<meta name="author" content="Grace Hopper"><meta property="og:site_name" content="Example Journal">
<meta name="date" content="2024-03-02"></head><body>
<nav><a href="/">Home</a> <a href="/about">About</a></nav>
<article><h1>On Reading Slowly</h1>
<p>Reading slowly is a skill that most researchers lose after their first year, because the pressure to process
many papers quickly rewards skimming over understanding. This essay argues for a different habit.</p>
<h2>Why speed misleads</h2>
<p>A fast reader collects claims. A slow reader collects the reasons behind the claims, and the reasons are what
a later argument needs when somebody challenges a quotation or asks where a number came from.</p>
<ul><li>Write down the exact wording before you paraphrase it.</li><li>Note the page, not only the paper.</li></ul>
<blockquote>The reader who cannot find the passage again has not really read it.</blockquote>
<h2>What to do instead</h2>
<p>Keep a library in which every source keeps its pages, so that a citation can point to the page where the
sentence stands and a reader can open it there with one click. That is the whole idea of the essay.</p>
</article><footer>Copyright 2024 Example Journal. All rights reserved. Subscribe to our newsletter.</footer></body></html>"""


def test_web_article(tmp_path):
    src = tmp_path / "essay.html"
    src.write_text(PAGE)
    out = tmp_path / "derived"
    m = convert.run({"sourcePath": str(src), "source": "0123456789ab", "outDir": str(out), "kind": "web"})
    assert m["path"] == "web" and "no-pages" in m["flags"]
    o = assert_schema_valid(out)
    assert_docs_consistent(o)
    texts = [b["text"] for b in o["blocks"]]
    types = {b["type"] for b in o["blocks"]}
    assert {"heading", "paragraph", "list-item"} <= types
    assert any("Reading slowly is a skill" in t for t in texts)
    assert not any("newsletter" in t or "Home" == t for t in texts), "boilerplate stays out"
    assert o["pages"]["pages"][0]["textSource"] == "html" and len(o["pages"]["pages"]) == 1
    assert o["blocks"][0]["spans"][0]["page"] == 0 and "bbox" not in o["blocks"][0]["spans"][0]
    header = (out / "header.json").read_text()
    assert "Grace Hopper" in header and "On Reading Slowly" in header


def test_web_reconversion_keeps_ids(tmp_path):
    src = tmp_path / "essay.html"
    src.write_text(PAGE)
    out1, out2 = tmp_path / "d1", tmp_path / "d2"
    base = {"sourcePath": str(src), "source": "0123456789ab", "kind": "web"}
    convert.run({**base, "outDir": str(out1)})
    src.write_text(PAGE.replace("Note the page, not only the paper.", "Always note the page and not only the paper."))
    convert.run({**base, "outDir": str(out2), "previousBlocks": str(out1 / "blocks.jsonl")})
    a, b = assert_schema_valid(out1), assert_schema_valid(out2)
    old = {x["id"] for x in a["blocks"]}
    new = {x["id"] for x in b["blocks"]}
    assert len(old & new) / len(old) >= 0.95


def test_empty_page_is_an_agent_error(tmp_path):
    src = tmp_path / "empty.html"
    src.write_text("<html><body></body></html>")
    with pytest.raises(ConvertError) as e:
        convert.run({"sourcePath": str(src), "source": "0123456789ab", "outDir": str(tmp_path / "o"), "kind": "web"})
    assert e.value.code == "WEB_NO_CONTENT" and e.value.fix


def test_epub_is_reported_as_unsupported(tmp_path):
    src = tmp_path / "book.epub"
    src.write_bytes(b"PK")
    with pytest.raises(ConvertError) as e:
        convert.run({"sourcePath": str(src), "source": "0123456789ab", "outDir": str(tmp_path / "o"), "kind": "epub"})
    assert e.value.code == "UNSUPPORTED_KIND"
