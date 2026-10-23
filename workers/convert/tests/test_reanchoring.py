"""Re-anchoring check on real Docling output (open item of docs/spikes/s3-anchoring.md).

S3 measured the anchoring algorithm on text that came from the same pdf.js items as the anchor, and called its 100 percent
an upper bound. Here the quotes come from a different engine: pypdf reads the text layer of the PDF, a quote is a random
word-aligned stretch of 4 to 30 words (at least 20 characters, 60 percent letters), and it has to land in the Docling blocks.

Resolution follows the S3 recommendation in reduced form, on the whitespace-insensitive stream that norm-v1 plus the
fuzzy stage amount to: exact match in the window of the quote's page plus and minus one, then a fuzzy match in the same
window, accepted at quote similarity of 0.9 (the "anchored" line). Negative control: remove the blocks of the quote's page
and window, the quote must then be orphaned everywhere else in the document.
"""

from __future__ import annotations

import json
import random
import re
import unicodedata

import pypdf
import pytest
from conftest import fixture_pdf
from rapidfuzz import fuzz

LIGATURES = {"ﬀ": "ff", "ﬁ": "fi", "ﬂ": "fl", "ﬃ": "ffi", "ﬄ": "ffl", "ﬅ": "st", "ﬆ": "st"}
ACCEPT = 90.0


def key(s: str) -> str:
    """citegeist-norm-v1 folds, then every non-word character goes, so spacing differences cannot matter."""
    s = re.sub("[­​‌‍﻿]", "", s)
    s = "".join(LIGATURES.get(c, c) for c in s)
    s = unicodedata.normalize("NFD", unicodedata.normalize("NFC", s))
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"\W+", "", s.lower())


def quotes(pdf, n, seed):
    reader = pypdf.PdfReader(str(pdf))
    rnd = random.Random(seed)
    out = []
    tries = 0
    while len(out) < n and tries < n * 20:
        tries += 1
        page = rnd.randrange(len(reader.pages))
        words = (reader.pages[page].extract_text() or "").split()
        if len(words) < 60:
            continue
        k = rnd.randint(4, 30)
        i = rnd.randrange(0, len(words) - k)
        q = " ".join(words[i : i + k])
        if len(q) >= 20 and sum(c.isalpha() for c in q) / len(q) >= 0.6:
            out.append((page, q))
    return out


def window_text(blocks, lo, hi, invert=False):
    parts = []
    for b in blocks:
        if b["flow"] == "furniture":
            continue
        inside = any(lo <= sp["page"] <= hi for sp in b["spans"])
        if inside != invert:
            parts.append(key(b["text"]))
    return "".join(parts)


def resolve(blocks, page, quote, n_pages):
    q = key(quote)
    win = window_text(blocks, max(0, page - 1), min(n_pages - 1, page + 1))
    if q in win:
        return "exact"
    if win and fuzz.partial_ratio_alignment(q, win, score_cutoff=ACCEPT) is not None:
        return "fuzzy"
    return None


@pytest.mark.parametrize("fid", ["tacl-natural-questions-2019", "merz-bne-2021", "nomos-huntington-review-1970"])
def test_quotes_from_the_text_layer_land_in_docling_blocks(fid, convert_fixture):
    out = convert_fixture(fid)
    blocks = [json.loads(line) for line in (out / "blocks.jsonl").read_text().splitlines()]
    pdf = fixture_pdf(fid)
    n_pages = len(pypdf.PdfReader(str(pdf)).pages)
    sel = quotes(pdf, 80, seed=11)
    assert len(sel) >= 60
    methods = [resolve(blocks, p, q, n_pages) for p, q in sel]
    anchored = sum(1 for m in methods if m)
    rate = anchored / len(sel)
    print(f"{fid}: {anchored}/{len(sel)} anchored ({methods.count('exact')} exact, {methods.count('fuzzy')} fuzzy)")
    assert rate >= 0.95, f"{rate:.1%} of quotes anchored"

    # Negative control: without the blocks of the quote's neighbourhood the quote must not anchor elsewhere.
    false_anchor = 0
    controls = 0
    for (page, q), m in zip(sel, methods, strict=True):
        if not m:
            continue
        controls += 1
        rest = window_text(blocks, max(0, page - 1), min(n_pages - 1, page + 1), invert=True)
        if rest and fuzz.partial_ratio_alignment(key(q), rest, score_cutoff=ACCEPT) is not None:
            false_anchor += 1
    print(f"{fid}: {false_anchor}/{controls} false anchors in the negative control")
    assert false_anchor / controls <= 0.05
