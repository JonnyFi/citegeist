"""Stable block ids.

First conversion: ids are minted from the source hash, page, type, the start of the normalised text and an
occurrence counter, so converting the same file twice gives the same ids. Re-conversion: every new block
looks for the previous block with the best combination of page overlap, bounding box IoU and text
similarity. A match keeps the old id. `idmap` records what happened to each old id (kept, moved into another
block after a merge or split, or null when the block is gone).
"""

from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from collections import defaultdict
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any

ID_RE = re.compile(r"^b[0-9a-z]{6,12}$")
MATCH_THRESHOLD = 0.55
MOVE_THRESHOLD = 0.5
ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz"


def norm(text: str) -> str:
    t = unicodedata.normalize("NFKC", text).lower().replace("­", "")
    return re.sub(r"\s+", " ", re.sub(r"[^\w\s]", "", t)).strip()


def _b36(data: bytes, n: int = 9) -> str:
    x = int.from_bytes(data, "big")
    out = []
    for _ in range(n):
        x, r = divmod(x, 36)
        out.append(ALPHABET[r])
    return "".join(out)


def mint(source: str, page: int, btype: str, text: str, occurrence: int = 0, salt: int = 0) -> str:
    key = f"{source}|{page}|{btype}|{norm(text)[:80]}|{occurrence}|{salt}"
    return "b" + _b36(hashlib.sha1(key.encode()).digest())


def iou(a: list[float], b: list[float]) -> float:
    ix = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    if inter <= 0:
        return 0.0
    ua = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / ua if ua > 0 else 0.0


def _boxes(block: dict[str, Any]) -> dict[int, list[float]]:
    out: dict[int, list[float]] = {}
    for sp in block.get("spans", []):
        bb = sp.get("bbox")
        if not bb:
            continue
        cur = out.get(sp["page"])
        out[sp["page"]] = (
            list(bb)
            if cur is None
            else [min(cur[0], bb[0]), min(cur[1], bb[1]), max(cur[2], bb[2]), max(cur[3], bb[3])]
        )
    return out


def _pages(block: dict[str, Any]) -> set[int]:
    return {sp["page"] for sp in block.get("spans", [])}


def _text_sim(a: str, b: str) -> float:
    if a == b:
        return 1.0
    if not a or not b:
        return 0.0
    sm = SequenceMatcher(None, a[:600], b[:600], autojunk=False)
    if sm.real_quick_ratio() < 0.5 or sm.quick_ratio() < 0.5:
        return 0.0
    return sm.ratio()


def score(new: dict[str, Any], old: dict[str, Any], new_norm: str, old_norm: str) -> float:
    np_, op_ = _pages(new), _pages(old)
    shared = np_ & op_
    if not shared:
        return 0.0
    nb, ob = _boxes(new), _boxes(old)
    best_iou = max((iou(nb[p], ob[p]) for p in shared if p in nb and p in ob), default=0.0)
    page_overlap = len(shared) / len(np_ | op_)
    if new_norm or old_norm:
        text = _text_sim(new_norm, old_norm)
    else:
        text = 1.0 if new["type"] == old["type"] else 0.0
    s = 0.6 * text + 0.3 * best_iou + 0.1 * page_overlap
    if new["type"] != old["type"]:
        s -= 0.05
    return s


def load_blocks(path: str | Path) -> list[dict[str, Any]]:
    out = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                out.append(json.loads(line))
    return out


def assign_ids(
    source: str,
    blocks: list[dict[str, Any]],
    previous: list[dict[str, Any]] | None = None,
) -> dict[str, str | None]:
    """Set `id` on every block (in place). Returns the idmap for the previous blocks (empty without any)."""
    previous = previous or []
    old_by_page: dict[int, list[int]] = defaultdict(list)
    for j, o in enumerate(previous):
        for p in _pages(o):
            old_by_page[p].append(j)
    new_norm = [norm(b["text"]) for b in blocks]
    old_norm = [norm(o.get("text", "")) for o in previous]

    pairs: list[tuple[float, int, int]] = []
    for i, b in enumerate(blocks):
        seen: set[int] = set()
        for p in _pages(b):
            for j in old_by_page.get(p, ()):
                if j in seen:
                    continue
                seen.add(j)
                s = score(b, previous[j], new_norm[i], old_norm[j])
                if s >= MOVE_THRESHOLD:
                    pairs.append((s, i, j))
    pairs.sort(key=lambda t: (-t[0], t[1], t[2]))

    new_for_old: dict[int, int] = {}
    old_for_new: dict[int, int] = {}
    for s, i, j in pairs:
        if s < MATCH_THRESHOLD:
            break
        if i in old_for_new or j in new_for_old:
            continue
        old_for_new[i] = j
        new_for_old[j] = i

    used: set[str] = {o["id"] for o in previous if "id" in o}
    occurrences: dict[tuple[int, str, str], int] = defaultdict(int)
    for i, b in enumerate(blocks):
        if i in old_for_new:
            b["id"] = previous[old_for_new[i]]["id"]
            continue
        page = b["spans"][0]["page"] if b.get("spans") else 0
        key = (page, b["type"], new_norm[i][:80])
        occ = occurrences[key]
        occurrences[key] += 1
        salt = 0
        bid = mint(source, page, b["type"], b["text"], occ, salt)
        while bid in used:
            salt += 1
            bid = mint(source, page, b["type"], b["text"], occ, salt)
        used.add(bid)
        b["id"] = bid
    # Matched ids are unique by construction, but a minted id could still equal a later matched id.
    seen_ids: set[str] = set()
    for b in blocks:
        if b["id"] in seen_ids:  # pragma: no cover - defensive
            raise AssertionError(f"duplicate block id {b['id']}")
        seen_ids.add(b["id"])

    idmap: dict[str, str | None] = {}
    best_new_for_old: dict[int, tuple[float, int]] = {}
    for s, i, j in pairs:
        if j not in best_new_for_old or s > best_new_for_old[j][0]:
            best_new_for_old[j] = (s, i)
    for j, o in enumerate(previous):
        if j in new_for_old:
            idmap[o["id"]] = blocks[new_for_old[j]]["id"]
        elif j in best_new_for_old:
            idmap[o["id"]] = blocks[best_new_for_old[j][1]]["id"]
        else:
            idmap[o["id"]] = None
    return idmap


def retention(idmap: dict[str, str | None]) -> float:
    """Share of previous ids that still exist unchanged."""
    if not idmap:
        return 1.0
    return sum(1 for k, v in idmap.items() if k == v) / len(idmap)
