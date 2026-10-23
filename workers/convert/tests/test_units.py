"""Unit tests that need neither models nor fixtures."""

from __future__ import annotations

import random
import shutil
import subprocess

import pytest
from conftest import ROOT

from citegeist_convert import ids, labels, refs, render, schemas


def block(btype="paragraph", text="x", page=0, bbox=(10, 10, 100, 40), **kw):
    b = {
        "type": btype,
        "flow": kw.pop("flow", "body"),
        "text": text,
        "spans": [{"page": page, "label": None, "start": 0, "end": len(text), "bbox": list(bbox)}],
        "src": {"engine": "test"},
    }
    b.update(kw)
    return b


# ---------------------------------------------------------------------------------- schema snapshot


def test_schema_snapshot_is_current():
    node = shutil.which("node")
    if not node or not (ROOT / "packages" / "schema" / "node_modules").exists():
        pytest.skip("node or pnpm install missing")
    script = ROOT / "workers" / "convert" / "scripts" / "export-schemas.mjs"
    r = subprocess.run([node, str(script), "--check"], capture_output=True, text=True, timeout=120)
    assert r.returncode == 0, r.stderr


def test_params_defaults_and_validation():
    p = schemas.convert_params_with_defaults(
        {"sourcePath": "/a.pdf", "source": "0123456789ab", "outDir": "/o", "kind": "pdf"}
    )
    assert p["ocr"] == "auto" and p["languages"] == ["de", "en"]
    assert schemas.errors("worker-convert-params", p) == []
    assert schemas.errors("worker-convert-params", {**p, "source": "xyz"})
    assert schemas.errors("worker-convert-params", {**p, "kind": "docx"})


# ------------------------------------------------------------------------------------------ ids


def make_doc(n=60, seed=1):
    rnd = random.Random(seed)
    words = "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau".split()
    blocks = []
    for i in range(n):
        text = " ".join(rnd.choice(words) + str(rnd.randint(0, 99)) for _ in range(30))
        row = i % 6
        blocks.append(block(text=text, page=i // 6, bbox=(50, 700 - row * 100, 500, 760 - row * 100)))
    return blocks


def test_ids_are_deterministic_and_valid():
    a, b = make_doc(), make_doc()
    ids.assign_ids("0123456789ab", a)
    ids.assign_ids("0123456789ab", b)
    assert [x["id"] for x in a] == [x["id"] for x in b]
    assert len({x["id"] for x in a}) == len(a)
    assert all(ids.ID_RE.match(x["id"]) for x in a)
    c = make_doc()
    ids.assign_ids("ffffffffffff", c)
    assert [x["id"] for x in a] != [x["id"] for x in c]


def test_duplicate_text_gets_distinct_ids():
    twins = [block(text="Same words again and again.", page=0, bbox=(0, 0, 10, 10)) for _ in range(3)]
    ids.assign_ids("0123456789ab", twins)
    assert len({t["id"] for t in twins}) == 3


def perturb(blocks, seed=5):
    """A re-conversion that shifts boxes, edits words in 10 percent of blocks, and merges and splits some."""
    rnd = random.Random(seed)
    out = []
    for i, b in enumerate(blocks):
        n = {**b, "spans": [dict(s) for s in b["spans"]]}
        x0, y0, x1, y1 = n["spans"][0]["bbox"]
        dx, dy = rnd.uniform(-4, 4), rnd.uniform(-4, 4)
        n["spans"][0]["bbox"] = [x0 + dx, y0 + dy, x1 + dx, y1 + dy]
        if i % 10 == 3:
            words = n["text"].split()
            words[5] = "changed"
            n["text"] = " ".join(words)
            n["spans"][0]["end"] = len(n["text"])
        n.pop("id", None)
        out.append(n)
    return out


def test_reconversion_carries_ids_over_geometry_and_text_noise():
    old = make_doc()
    ids.assign_ids("0123456789ab", old)
    new = perturb(old)
    idmap = ids.assign_ids("0123456789ab", new, previous=old)
    kept = sum(1 for o, n in zip(old, new, strict=True) if o["id"] == n["id"])
    assert kept / len(old) >= 0.95
    assert ids.retention(idmap) >= 0.95
    assert len({n["id"] for n in new}) == len(new)


def test_idmap_marks_deleted_and_merged_blocks():
    old = make_doc(12)
    ids.assign_ids("0123456789ab", old)
    new = [b for i, b in enumerate(perturb(old)) if i != 4]  # delete one block
    idmap = ids.assign_ids("0123456789ab", new, previous=old)
    assert idmap[old[4]["id"]] is None
    assert all(v is not None for k, v in idmap.items() if k != old[4]["id"])
    # a new block never takes over the id of a deleted block it does not match
    stranger = block(text="Completely unrelated sentence about something else entirely.", page=0, bbox=(300, 10, 400, 20))
    ids.assign_ids("0123456789ab", [*new, stranger], previous=old)
    assert stranger["id"] not in {b["id"] for b in old}


def test_ids_without_geometry_use_text():
    old = [block(text=f"Paragraph number {i} of a web page with some words in it.", bbox=(0, 0, 0, 0)) for i in range(20)]
    for b in old:
        b["spans"][0].pop("bbox")
    ids.assign_ids("0123456789ab", old)
    new = [{**b, "spans": [dict(s) for s in b["spans"]]} for b in old]
    for b in new:
        b.pop("id")
    ids.assign_ids("0123456789ab", new, previous=old)
    assert [b["id"] for b in new] == [b["id"] for b in old]


# --------------------------------------------------------------------------------------- labels


def footer_blocks(numbers, h=800, w=600):
    return [
        {
            "type": "page-furniture",
            "flow": "furniture",
            "text": str(n),
            "spans": [{"page": i, "label": None, "start": 0, "end": len(str(n)), "bbox": [290, 20, 310, 32]}],
        }
        for i, n in enumerate(numbers)
        if n is not None
    ]


def test_detected_numbers_win_without_catalog():
    n = 10
    res = labels.compute(n, None, footer_blocks(range(21, 31)), [(600, 800)] * n, None, 0.9, 400)
    assert res.labels == [str(21 + i) for i in range(n)]
    assert res.label_source == "header-footer"
    assert min(res.confidence) >= 0.9


def test_trivial_catalog_yields_to_disagreeing_run():
    n = 10
    cat = [str(i + 1) for i in range(n)]
    res = labels.compute(n, cat, footer_blocks(range(100, 110)), [(600, 800)] * n, None, 0.9, 400)
    assert res.label_source == "header-footer"
    assert res.labels[0] == "100"


def test_catalog_with_duplicates_is_flagged():
    n = 8
    cat = ["1", "1", "i", "i", "ii", "1", "2", "3"]
    res = labels.compute(n, cat, [], [(600, 800)] * n, None, 0.9, 400)
    assert res.label_source == "pdf-pagelabels"
    assert res.confidence[0] <= 0.3 and res.confidence[1] <= 0.3
    assert any("duplicates" in f for f in res.flags)


def test_crossref_range_needs_matching_length_and_e_locators_are_refused():
    n = 5
    res = labels.compute(n, None, [], [(600, 800)] * n, "257-261", 0.9, 400)
    assert res.labels == ["257", "258", "259", "260", "261"] and res.label_source == "crossref-offset"
    assert labels.compute(n, None, [], [(600, 800)] * n, "e115253", 0.9, 400).label_source == "none"
    assert labels.compute(n, None, [], [(600, 800)] * n, "10-40", 0.9, 400).label_source == "none"


def test_poor_text_quality_caps_confidence():
    n = 10
    res = labels.compute(n, None, footer_blocks(range(1, 11)), [(600, 800)] * n, None, 0.3, 500)
    assert max(res.confidence) <= 0.2


def test_furniture_runs_fold_page_numbers():
    n = 6
    blocks = footer_blocks(range(10, 16))
    runs = labels.furniture_runs(blocks, [(600, 800)] * n)
    assert runs and runs[0]["pattern"] == "#" and runs[0]["pages"] == list(range(n))


# --------------------------------------------------------------------------------------- render


def two_page_blocks():
    a = block("title", "A Title", page=0)
    b = block("paragraph", "First paragraph " + "x" * 20 + " second page part continues here", page=0)
    b["spans"] = [
        {"page": 0, "label": "7", "start": 0, "end": 40, "bbox": [0, 0, 1, 1]},
        {"page": 1, "label": "8", "start": 40, "end": len(b["text"]), "bbox": [0, 0, 1, 1]},
    ]
    c = block("list-item", "item one", page=1)
    d = block("equation", "E=mc^2", page=1, latex="E=mc^2")
    f = block("page-furniture", "7", page=0, flow="furniture")
    blocks = [a, b, f, c, d]
    ids.assign_ids("0123456789ab", blocks)
    pages = [{"index": 0, "label": "7"}, {"index": 1, "label": "8"}]
    for blk in blocks:
        for sp in blk["spans"]:
            sp["label"] = pages[sp["page"]]["label"]
    return blocks, pages


def test_markdown_follows_the_format_spec():
    blocks, pages = two_page_blocks()
    md = render.render_md(blocks, pages, {})
    lines = md.splitlines()
    assert lines[0] == "<!-- page 0 label=7 -->"
    assert "<!-- page 1 label=8 -->" in lines
    para = next(ln for ln in lines if ln.startswith("First paragraph"))
    assert "<!-- p:8 -->" in para and para.endswith(f" ^{blocks[1]['id']}")
    assert f"# A Title ^{blocks[0]['id']}" in lines
    assert f"- item one ^{blocks[3]['id']}" in lines
    assert f"$$\nE=mc^2\n$$\n\n^{blocks[4]['id']}" in md
    assert blocks[2]["id"] not in md  # furniture stays out


def test_html_has_ids_page_attributes_and_break_markers():
    blocks, pages = two_page_blocks()
    out = render.render_html(blocks, pages, {}, "T", "en", "0123456789ab")
    assert f'id="{blocks[1]["id"]}"' in out and 'data-page="0"' in out and 'data-label="7"' in out
    assert 'class="page-break"' in out and 'data-page="1" data-label="8"' in out
    assert f'id="{blocks[2]["id"]}"' not in out
    assert "<ul>" in out and "<li" in out
    from lxml import html as lh

    tree = lh.fromstring(out)
    element_ids = [e.get("id") for e in tree.iter() if e.get("id")]
    assert len(element_ids) == len(set(element_ids))
    para = tree.get_element_by_id(blocks[1]["id"])
    assert [s.get("data-page") for s in para.iter("span")] == ["1"], "one page-break marker inside the paragraph"


def test_unlabelled_pages_use_index_markers():
    blocks, pages = two_page_blocks()
    pages = [{"index": 0, "label": None}, {"index": 1, "label": None}]
    md = render.render_md(blocks, pages, {})
    assert "<!-- page 0 -->" in md and "<!-- p:#1 -->" in md


# ---------------------------------------------------------------------------------------- refs


def test_reference_section_is_split_without_grobid():
    blocks = [
        block("heading", "1 Introduction", _level=1),
        block("paragraph", "Body text."),
        block("heading", "References", _level=1),
        block("paragraph", "Doe, J. (2019). A title. Journal 3, 1-9. doi:10.1000/xyz123."),
        block("list-item", "Roe, R. (2001). Another one."),
        block("heading", "Appendix A", _level=1),
        block("paragraph", "Not a reference."),
    ]
    idx = refs.mark_reference_blocks(blocks)
    assert idx == [3, 4] and blocks[3]["type"] == "reference" and blocks[6]["type"] == "paragraph"
    for i, b in enumerate(blocks):
        b["id"] = f"b{i:07d}"
    entries = refs.from_blocks(blocks, idx, "docling")
    assert entries[0]["doi"] == "10.1000/xyz123" and entries[0]["year"] == "2019"
    assert entries[1]["blockId"] == "b0000004"
