"""Reference entries for refs.jsonl when GROBID is not available: split the reference section of the blocks."""

from __future__ import annotations

import re
from typing import Any

HEADING = re.compile(
    r"^(?:[\dIVXA-Z]+[.)]?\s+)?(references|bibliography|literatur(?:verzeichnis)?|quellen(?:verzeichnis)?|works cited|literaturhinweise)\s*:?$",
    re.IGNORECASE,
)
DOI = re.compile(r"10\.\d{4,9}/[^\s\"<>]+")
YEAR = re.compile(r"\b(1[5-9]\d\d|20\d\d)\b")


def _entry(i: int, raw: str, source: str, block_id: str | None = None) -> dict[str, Any]:
    doi = DOI.search(raw)
    year = YEAR.search(raw)
    out = {
        "key": f"r{i}",
        "raw": raw,
        "title": None,
        "venue": None,
        "authors": [],
        "year": year.group(1) if year else None,
        "doi": doi.group(0).rstrip(".,;)") if doi else None,
        "source": source,
    }
    if block_id:
        out["blockId"] = block_id
    return out


def mark_reference_blocks(blocks: list[dict[str, Any]]) -> list[int]:
    """Indices of the reference-section blocks. Retypes paragraphs and list items to `reference`."""
    start = None
    for i, b in enumerate(blocks):
        if b["type"] == "heading" and HEADING.match(b["text"].strip()):
            start = i  # the last matching heading wins (appendices can repeat the word)
    if start is None:
        return [i for i, b in enumerate(blocks) if b["type"] == "reference"]
    level = blocks[start].get("_level", 1)
    idx = []
    for j in range(start + 1, len(blocks)):
        b = blocks[j]
        if b["type"] == "heading" and b.get("_level", 1) <= level:
            break
        if b["flow"] != "body":
            continue
        if b["type"] in ("paragraph", "list-item", "reference"):
            b["type"] = "reference"
            idx.append(j)
    return idx


def from_blocks(blocks: list[dict[str, Any]], indices: list[int], source: str) -> list[dict[str, Any]]:
    out = []
    for i, j in enumerate(indices):
        b = blocks[j]
        if b["text"].strip():
            out.append(_entry(i, " ".join(b["text"].split()), source, b.get("id")))
    return out
