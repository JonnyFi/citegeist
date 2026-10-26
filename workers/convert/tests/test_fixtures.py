"""Every fixture of fixtures/pdf/manifest.json converts to schema-valid outputs and meets the S1 criteria.

The default run converts the FAST set (small documents). The rest of the corpus is marked `slow`:

    uv run pytest -m slow          only the slow fixtures
    uv run pytest -m ''            everything
"""

from __future__ import annotations

import json

import pytest
from conftest import FAST, fixture_pdf, manifest_fixtures
from helpers import assert_docs_consistent, assert_schema_valid, page_correctness, read_outputs

from citegeist_convert import ids, quality

PARAMS = [
    pytest.param(f["id"], marks=[] if f["id"] in FAST else [pytest.mark.slow], id=f["id"])
    for f in manifest_fixtures()
]
BY_ID = {f["id"]: f for f in manifest_fixtures()}


@pytest.mark.parametrize("fid", PARAMS)
def test_fixture_outputs(fid, convert_fixture):
    fx = BY_ID[fid]
    out = convert_fixture(fid)
    o = assert_schema_valid(out)
    assert_docs_consistent(o)
    manifest, pages = o["manifest"], o["pages"]
    assert len(pages["pages"]) == fx["pages"]
    scan = "no-text-layer" in fx["kind"]
    assert manifest["path"] == ("scan" if scan else "digital")

    if scan:
        assert "ocr" in manifest["flags"]
        assert all(p["textSource"] == "ocr" for p in pages["pages"])
        # Poor OCR must be flagged, not passed off as text. How well a page reads depends on the
        # engine (Apple Vision on macOS, RapidOCR elsewhere), so the flags are checked against the
        # quality measured per page rather than assumed.
        low = [p["index"] for p in pages["pages"] if p.get("quality") is None or p["quality"] < quality.GATE]
        flagged = next((f for f in manifest["flags"] if f.startswith("low-quality-pages:")), None)
        if low:
            assert "low-quality" in manifest["flags"], "poor OCR must be flagged, not passed off as text"
            assert flagged == f"low-quality-pages:{','.join(str(i) for i in low)}"
        else:
            assert "low-quality" not in manifest["flags"] and flagged is None, "readable OCR is not flagged"
        if "negative-control" in fx["kind"]:
            assert len(low) == fx["pages"], "every page of the control is unreadable"
        return

    # S1 criterion: at least 95 percent of verifiable blocks sit on the page they claim.
    ok, wrong, _ = page_correctness(fixture_pdf(fid), o["blocks"])
    assert ok > 0
    assert ok / (ok + wrong) >= 0.95, f"{wrong} of {ok + wrong} blocks on the wrong page"

    # Printed page labels against the gold label of the manifest.
    first = fx["expected"]["firstPrintedPage"]
    if first is not None:
        right = bad_confident = 0
        for p in pages["pages"]:
            gold = str(first + p["index"])
            if p["label"] == gold:
                right += 1
            elif p["labelConfidence"] >= 0.5:
                bad_confident += 1
        assert bad_confident == 0, "a wrong label with confidence of 0.5 or more"
        assert right / fx["pages"] >= 0.9, f"{right} of {fx['pages']} labels correct"
    else:
        # No gold label: whatever is not certain must be marked uncertain.
        assert all(p["labelConfidence"] <= 0.95 for p in pages["pages"])

    assert len(o["refs"]) >= 0
    json.dumps(o["pages"])


@pytest.mark.parametrize("fid", PARAMS)
def test_reconversion_keeps_block_ids(fid, convert_fixture):
    """Converting the same file again with previousBlocks keeps at least 95 percent of the ids."""
    first = convert_fixture(fid)
    second = convert_fixture(fid, tag="again", previous=first)
    a, b = read_outputs(first), read_outputs(second)
    old_ids = {blk["id"] for blk in a["blocks"]}
    new_ids = {blk["id"] for blk in b["blocks"]}
    kept = len(old_ids & new_ids) / max(1, len(old_ids))
    assert kept >= 0.95, f"only {kept:.1%} of block ids survived"
    assert ids.retention(b["idmap"]) >= 0.95
    assert set(b["idmap"]) == old_ids
    # S1 speed criterion on the warm pipeline: under 60 s for 20 pages.
    per_page_ms = b["manifest"]["durationMs"] / BY_ID[fid]["pages"]
    assert per_page_ms < 3000, f"{per_page_ms:.0f} ms per page"
