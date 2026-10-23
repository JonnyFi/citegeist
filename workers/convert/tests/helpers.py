"""Checks that every conversion output has to pass."""

from __future__ import annotations

import json
import re
import unicodedata
from pathlib import Path
from typing import Any

import pypdf

from citegeist_convert import schemas


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKC", s).lower().replace("­", "")
    return re.sub(r"[\W_]+", "", s)


def read_outputs(out: Path) -> dict[str, Any]:
    return {
        "manifest": json.loads((out / "manifest.json").read_text()),
        "pages": json.loads((out / "pages.json").read_text()),
        "idmap": json.loads((out / "idmap.json").read_text()),
        "blocks": [json.loads(line) for line in (out / "blocks.jsonl").read_text().splitlines() if line],
        "refs": [json.loads(line) for line in (out / "refs.jsonl").read_text().splitlines() if line],
        "md": (out / "doc.md").read_text(),
        "html": (out / "doc.html").read_text(),
    }


def assert_schema_valid(out: Path) -> dict[str, Any]:
    o = read_outputs(out)
    assert schemas.errors("derived-manifest", o["manifest"]) == []
    assert schemas.errors("pages", o["pages"]) == []
    assert schemas.errors("idmap", o["idmap"]) == []
    ids = set()
    for b in o["blocks"]:
        assert schemas.errors("block", b) == [], b.get("id")
        assert b["id"] not in ids, "duplicate block id"
        ids.add(b["id"])
        for sp in b["spans"]:
            assert sp["start"] <= sp["end"] <= len(b["text"]) or b["type"] in ("figure",), (b["id"], sp)
            assert sp["page"] < len(o["pages"]["pages"])
    for r in o["refs"]:
        assert isinstance(r.get("raw"), str | type(None))
    assert (out / "assets").is_dir()
    return o


def assert_docs_consistent(o: dict[str, Any]) -> None:
    """doc.md and doc.html carry every non-furniture block with its id."""
    visible = [b for b in o["blocks"] if b["flow"] != "furniture"]
    for b in visible:
        assert re.search(rf" \^{b['id']}$", o["md"], re.M) or re.search(rf"^\^{b['id']}$", o["md"], re.M), b["id"]
        assert f'id="{b["id"]}"' in o["html"], b["id"]
    for b in o["blocks"]:
        if b["flow"] == "furniture":
            assert f'id="{b["id"]}"' not in o["html"]
    n_pages_used = {b["spans"][0]["page"] for b in visible if b["spans"]}
    for p in n_pages_used:
        assert re.search(rf"^<!-- page {p}( label=.*)? -->$", o["md"], re.M), p
    assert 'data-page="' in o["html"]


def page_correctness(pdf: Path, blocks: list[dict[str, Any]]) -> tuple[int, int, int]:
    """S1 criterion: blocks on the correct page. (verified, wrong, not verifiable)

    A block is verified when the first or last 24 normalised characters of its text occur in the pypdf text of the
    page its (first) span claims.
    """
    reader = pypdf.PdfReader(str(pdf))
    pages = [norm(p.extract_text() or "") for p in reader.pages]
    ok = wrong = unverifiable = 0
    for b in blocks:
        if b["flow"] == "furniture" or b["type"] in ("figure", "table", "equation"):
            continue
        for sp in b["spans"]:
            seg = norm(b["text"][sp["start"] : sp["end"]])
            if len(seg) < 30:
                unverifiable += 1
                continue
            head, tail = seg[:24], seg[-24:]
            text = pages[sp["page"]]
            if head in text or tail in text:
                ok += 1
            else:
                wrong += 1
    return ok, wrong, unverifiable
