"""Printed page labels.

Sources, as validated in spike S1: the /PageLabels catalog, number runs in headers and footers, and
the offset implied by a Crossref page range. A catalog that is plain 1..n or has duplicates yields to a
detected run that disagrees. Crossref is only accepted when the range length matches the page count
and detected numbers confirm it on at least three pages. Every label carries a confidence; duplicates
and poor text quality cap it. Below about 0.5 the app asks the user once per PDF.
"""

from __future__ import annotations

import math
import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from typing import Any

TOKEN = re.compile(r"(?<![\w.,/\-])(\d{1,4})(?![\w.,%/\-])")
BAND = 0.12  # top and bottom band of the page that counts as header or footer area
SOURCE_NAME = {
    "catalog": "pdf-pagelabels",
    "detected": "header-footer",
    "crossref": "crossref-offset",
    "none": "none",
}


@dataclass
class LabelResult:
    labels: list[str | None]
    source: str  # key of SOURCE_NAME
    confidence: list[float]
    flags: list[str] = field(default_factory=list)
    furniture_runs: list[dict[str, Any]] = field(default_factory=list)
    evidence: dict[str, Any] = field(default_factory=dict)

    @property
    def label_source(self) -> str:
        return SOURCE_NAME[self.source]


def _band_blocks(blocks, sizes):
    """Yield (page, kind, text) for header and footer candidates."""
    for b in blocks:
        text = b["text"]
        for sp in b["spans"]:
            page = sp["page"]
            if page >= len(sizes) or not sp.get("bbox"):
                continue
            h = sizes[page][1]
            y0, y1 = sp["bbox"][1], sp["bbox"][3]
            top = y1 >= h * (1 - BAND)
            bottom = y0 <= h * BAND
            seg = text[sp["start"] : sp["end"]] if sp["end"] > sp["start"] else text
            short = len(seg.strip()) <= 60
            furniture = b["flow"] == "furniture"
            if not (furniture or ((top or bottom) and short)):
                continue
            kind = "header" if (top and not bottom) or (furniture and y1 >= h * 0.5) else "footer"
            yield page, kind, seg


def detect_candidates(blocks, sizes) -> dict[int, set[int]]:
    cands: dict[int, set[int]] = defaultdict(set)
    for page, _kind, text in _band_blocks(blocks, sizes):
        for m in TOKEN.finditer(text):
            v = int(m.group(1))
            if v == 0 or (1900 <= v <= 2100 and len(text.strip()) > 4):
                continue
            cands[page].add(v)
    return cands


def vote_offset(cands: dict[int, set[int]], n: int) -> tuple[int | None, int]:
    votes: Counter[int] = Counter()
    for i, vals in cands.items():
        for off in {v - i for v in vals}:
            votes[off] += 1
    if not votes:
        return None, 0
    off, k = votes.most_common(1)[0]
    need = max(2, math.ceil(0.3 * n)) if n > 3 else 2
    return (off, k) if k >= need else (None, k)


def crossref_labels(range_hint: str | None, n: int) -> tuple[list[str | None] | None, str]:
    if not range_hint:
        return None, "no page range hint"
    m = re.fullmatch(r"(\d+)\s*[-–—]\s*(\d+)", range_hint.strip())
    if not m:
        return None, f"not a numeric range ({range_hint})"
    a, b = int(m.group(1)), int(m.group(2))
    span = b - a + 1
    injected = n - span
    if span < 1 or injected < 0 or injected > 2:
        return None, f"range length {span} does not match {n} pages"
    return [None] * injected + [str(a + k) for k in range(span)], f"range {a}-{b}, {injected} injected page(s)"


def _trivial(labels: list[str]) -> bool:
    return all(label == str(i + 1) for i, label in enumerate(labels))


def furniture_runs(blocks, sizes) -> list[dict[str, Any]]:
    """Repeated header and footer lines. Digits are folded so that "Seite 12" and "Seite 13" form one run."""
    n = len(sizes)
    groups: dict[tuple[str, str], dict[str, Any]] = {}
    for page, kind, text in _band_blocks(blocks, sizes):
        pattern = re.sub(r"\d+", "#", " ".join(text.split())).lower()
        if not pattern:
            continue
        g =groups.setdefault((kind, pattern), {"kind": kind, "pattern": pattern, "example": text.strip(), "pages": set()})
        g["pages"].add(page)
    need = 2 if n <= 5 else max(3, math.ceil(0.2 * n))
    out = []
    for g in groups.values():
        if len(g["pages"]) >= need:
            out.append({**g, "pages": sorted(g["pages"])})
    out.sort(key=lambda g: (g["kind"], -len(g["pages"])))
    return out


def compute(
    n: int,
    catalog: list[str] | None,
    blocks: list[dict[str, Any]],
    sizes: list[tuple[float, float]],
    range_hint: str | None,
    text_hit_rate: float | None,
    text_words: int,
) -> LabelResult:
    cands = detect_candidates(blocks, sizes)
    off, votes = vote_offset(cands, n)
    det: list[str | None] | None = None
    if off is not None:
        det = [str(i + off) if i + off >= 1 else None for i in range(n)]
    xr, xr_note = crossref_labels(range_hint, n)

    def agree(a, b):
        pairs = [(x, y) for x, y in zip(a, b, strict=True) if x and y]
        return sum(1 for x, y in pairs if x == y), len(pairs)

    def support(labels):
        return sum(1 for i, lab in enumerate(labels) if lab and lab.isdigit() and int(lab) in cands.get(i, ()))

    chosen: list[str | None] | None = None
    source, conf = "none", 0.0
    flags: list[str] = []
    cat = catalog if catalog is not None and len(catalog) == n else None
    if cat is not None:
        dup = 1 - len(set(cat)) / n
        triv = _trivial(cat)
        if dup > 0.1:
            flags.append(f"catalog labels contain {dup:.0%} duplicates")
        if triv:
            flags.append("catalog is plain 1..n")
        cat_supported = support(cat)
        if not triv and dup <= 0.1:
            chosen, source = list(cat), "catalog"
            conf = 0.95 if cat_supported >= max(2, 0.3 * n) else 0.8
        elif det and det != cat and support(det) >= support(cat):
            chosen, source, conf = det, "detected", min(0.95, 1.2 * votes / n)
            flags.append("detected run overrides trivial or suspect catalog")
        else:
            chosen, source = list(cat), "catalog"
            conf = 0.7 if triv and cat_supported >= 2 else 0.3
    if chosen is None and det:
        chosen, source, conf = det, "detected", min(0.95, 1.2 * votes / n)
    if chosen is None and xr:
        # Crossref alone is only a weak guess: nothing else confirmed it.
        chosen, source, conf = xr, "crossref", 0.6
    if chosen is None:
        chosen, source, conf = [None] * n, "none", 0.0
        flags.append("no evidence for printed page numbers")
    if xr and det:
        ok, tot = agree(xr, det)
        if tot >= 3 and ok / tot >= 0.9:
            conf = max(conf, 0.97)
            flags.append(f"crossref agrees with detected numbers on {ok}/{tot} pages")
        elif tot >= 3:
            flags.append(f"crossref disagrees with detected numbers ({ok}/{tot})")
    if text_hit_rate is not None and text_words >= 50 and text_hit_rate < 0.6:
        conf = min(conf, 0.2)
        flags.append(f"text quality too low for label detection (dictionary hit rate {text_hit_rate:.2f})")
    dups = {x for x, c in Counter(chosen).items() if x and c > 1} if source == "catalog" else set()
    if dups:
        flags.append(f"duplicate catalog labels: {sorted(dups)[:6]}")
    confidences = [0.0 if chosen[i] is None else (0.3 if chosen[i] in dups else round(conf, 2)) for i in range(n)]
    evidence = {
        "catalog": {"labels": catalog},
        "detected": {"labels": det, "offset": off, "votes": votes},
        "crossref": {"labels": xr, "note": xr_note},
    }
    return LabelResult(chosen, source, confidences, flags, furniture_runs(blocks, sizes), evidence)
