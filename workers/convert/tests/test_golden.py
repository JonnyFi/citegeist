"""Golden test for doc.md on two fixtures.

Regenerate with `UPDATE_GOLDEN=1 uv run pytest tests/test_golden.py` after an intended change of the output.
The comparison tolerates 0.5 percent of differing lines, because the layout model may move a block boundary
on another chip or torch version. The format itself (page markers, block id suffixes) is also checked line by line.
"""

from __future__ import annotations

import difflib
import os
import re

import pytest
from conftest import HERE

GOLDEN = HERE / "golden"


@pytest.mark.parametrize("fid", ["nomos-huntington-review-1970", "merz-bne-2021"])
def test_doc_md_matches_golden(fid, convert_fixture):
    md = (convert_fixture(fid) / "doc.md").read_text()
    path = GOLDEN / f"{fid}.doc.md"
    if os.environ.get("UPDATE_GOLDEN"):
        path.write_text(md)
    assert path.exists(), "golden file missing: run with UPDATE_GOLDEN=1"
    golden = path.read_text()
    if md != golden:
        ratio = difflib.SequenceMatcher(None, golden.splitlines(), md.splitlines(), autojunk=False).ratio()
        diff = "\n".join(list(difflib.unified_diff(golden.splitlines(), md.splitlines(), lineterm="", n=0))[:30])
        assert ratio >= 0.995, f"doc.md differs from golden (line similarity {ratio:.4f}):\n{diff}"

    # Format invariants, independent of the golden file.
    lines = md.splitlines()
    assert re.fullmatch(r"<!-- page 0 label=\d+ -->", lines[0])
    ends = len(re.findall(r" \^b[0-9a-z]{6,12}$", md, re.M)) + len(re.findall(r"^\^b[0-9a-z]{6,12}$", md, re.M))
    assert ends > 20
