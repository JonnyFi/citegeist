"""Printed page labels: /PageLabels, header/footer number runs, Crossref range offset.

Reads out/<id>/blocks.jsonl (raw Docling blocks), writes out/<id>/pages.json and fills `label` in blocks.jsonl.
usage: uv run python labels.py [id ...]
"""
import json
import logging
import math
import re
import sys
from collections import Counter, defaultdict

import pypdf

from common import is_scan, out_dir, pdf_path, select
from quality import hit_rate

logging.disable(logging.CRITICAL)
TOKEN = re.compile(r"(?<![\w.,/\-])(\d{1,4})(?![\w.,%/\-])")
BAND = 0.12  # top/bottom band of the page that counts as header/footer area


def catalog_labels(reader):
    """Return (labels or None, note). Uses pypdf's page_labels; empty prefix-only ranges give the prefix."""
    root = reader.trailer["/Root"]
    if "/PageLabels" not in root:
        return None, "no /PageLabels"
    try:
        return [str(x) for x in reader.page_labels], "ok"
    except Exception as e:  # pragma: no cover
        return None, f"unreadable: {e}"


def detect_candidates(blocks, page_sizes, n):
    """Numeric tokens from header/footer furniture and blocks in the top/bottom band, per page index."""
    cands = defaultdict(set)
    for b in blocks:
        h = page_sizes.get(str(b["page"] + 1), [0, 0])[1] or 800
        y0, y1 = b["bbox"][1], b["bbox"][3]  # PDF space, origin bottom
        in_band = y1 >= h * (1 - BAND) or y0 <= h * BAND
        if not (b["flow"] == "furniture" or b["type"] in ("page_header", "page_footer") or (in_band and len(b["text"]) <= 60)):
            continue
        for m in TOKEN.finditer(b["text"]):
            v = int(m.group(1))
            if v == 0 or (1900 <= v <= 2100 and len(b["text"].strip()) > 4):
                continue
            cands[b["page"]].add(v)
    return cands


def vote_offset(cands, n):
    votes = Counter()
    for i, vals in cands.items():
        for off in {v - i for v in vals}:
            votes[off] += 1
    if not votes:
        return None, 0
    off, k = votes.most_common(1)[0]
    need = max(2, math.ceil(0.3 * n)) if n > 3 else 2
    return (off, k) if k >= need else (None, k)


def crossref_labels(crossref_pages, n):
    if not crossref_pages:
        return None, "no Crossref pages"
    m = re.fullmatch(r"(\d+)\s*[-–]\s*(\d+)", crossref_pages.strip())
    if not m:
        return None, f"not a numeric range ({crossref_pages})"
    a, b = int(m.group(1)), int(m.group(2))
    span = b - a + 1
    injected = n - span
    if injected < 0 or injected > 2:
        return None, f"range length {span} does not match {n} pages"
    labels = [None] * injected + [str(a + k) for k in range(span)]
    return labels, f"range {a}-{b}, {injected} injected page(s)"


def trivial(labels):
    return all(l == str(i + 1) for i, l in enumerate(labels))


def process(fx):
    od = out_dir(fx)
    reader = pypdf.PdfReader(pdf_path(fx))
    n = len(reader.pages)
    blocks = [json.loads(l) for l in open(od / "blocks.jsonl")]
    meta = json.load(open(od / "convert_meta.json"))
    sizes = meta["page_sizes"]

    cat, cat_note = catalog_labels(reader)
    cands = detect_candidates(blocks, sizes, n)
    off, votes = vote_offset(cands, n)
    det = [str(i + off) if (off is not None and i + off >= 1) else None for i in range(n)] if off is not None else None
    xr, xr_note = crossref_labels(fx.get("crossrefPages"), n)

    def agree(a, b):
        pairs = [(x, y) for x, y in zip(a, b) if x and y]
        return (sum(1 for x, y in pairs if x == y), len(pairs))

    # evidence from the page itself: pages whose candidate set contains the label
    def support(labels):
        k = sum(1 for i, l in enumerate(labels) if l and l.isdigit() and int(l) in cands.get(i, ()))
        return k

    chosen, source, conf, flags = None, "fallback", 0.1, []
    if cat is not None and len(cat) == n:
        dup = 1 - len(set(cat)) / n
        if dup > 0.1:
            flags.append(f"catalog labels contain {dup:.0%} duplicates")
        if trivial(cat):
            flags.append("catalog is plain 1..n")
        cat_supported = support(cat)
        if not trivial(cat) and dup <= 0.1:
            chosen, source = cat, "catalog"
            conf = 0.95 if cat_supported >= max(2, 0.3 * n) else 0.8
        elif det and (trivial(cat) or dup > 0.1):
            # catalog is trivial or suspect: prefer detected numbers if they exist and differ
            if det != cat and support(det) >= support(cat):
                chosen, source, conf = det, "detected", min(0.95, 1.2 * votes / n)
                flags.append("detected run overrides trivial/suspect catalog")
            else:
                chosen, source, conf = cat, "catalog", 0.7 if trivial(cat) and cat_supported >= 2 else 0.3
        else:
            chosen, source, conf = cat, "catalog", 0.7 if trivial(cat) and cat_supported >= 2 else 0.3
    if chosen is None and det:
        chosen, source, conf = det, "detected", min(0.95, 1.2 * votes / n)
    if chosen is None and xr:
        k, m = agree(xr, [None] * n)
        chosen, source, conf = xr, "crossref-offset", 0.6
    if chosen is None:
        chosen, source = [str(i + 1) for i in range(n)], "fallback"
        flags.append("no evidence, physical index + 1")
    # Crossref cross-check raises confidence when it agrees with detection
    if xr and det:
        ok, tot = agree(xr, det)
        if tot >= 3 and ok / tot >= 0.9:
            conf = max(conf, 0.97)
            flags.append(f"crossref agrees with detected on {ok}/{tot} pages")
        elif tot >= 3:
            flags.append(f"crossref disagrees with detected ({ok}/{tot})")
    # text quality gate: dictionary hit rate over the whole document
    body = " ".join(b["text"] for b in blocks if b["flow"] == "body" and b["type"] in ("paragraph", "heading", "list_item", "footnote"))
    hr, nw = hit_rate(body, "de" if fx["language"] == "de" else "en")
    if hr is not None and nw >= 50 and hr < 0.6:
        conf = min(conf, 0.2)
        flags.append(f"text quality too low for label detection (dictionary hit rate {hr:.2f})")
    dup_labels = {x for x, c in Counter(chosen).items() if x and c > 1} if source == "catalog" else set()
    if dup_labels:
        flags.append(f"duplicate catalog labels: {sorted(dup_labels)[:6]}")
    pages = []
    for i in range(n):
        pconf = 0.3 if chosen[i] in dup_labels else conf
        pages.append({
            "index": i,
            "label": chosen[i],
            "labelSource": source,
            "confidence": round(pconf, 2),
            "size": sizes.get(str(i + 1)),
            "textSource": "ocr" if is_scan(fx) else "born-digital",
            "nBlocks": sum(1 for b in blocks if b["page"] == i and b["flow"] == "body"),
        })
    out = {
        "pages": pages,
        "sources": {
            "catalog": {"labels": cat, "note": cat_note},
            "detected": {"labels": det, "offset": off, "votes": votes, "candidatesPerPage": {str(k): sorted(v) for k, v in sorted(cands.items())}},
            "crossref": {"labels": xr, "note": xr_note},
        },
        "flags": flags,
    }
    (od / "pages.json").write_text(json.dumps(out, indent=1, ensure_ascii=False))
    with open(od / "blocks.jsonl", "w") as f:
        for b in blocks:
            b["label"] = chosen[b["page"]]
            for sp in b["spans"]:
                sp["label"] = chosen[sp["page"]]
            f.write(json.dumps(b, ensure_ascii=False) + "\n")
    print(f"{fx['id']:40s} source={source:16s} conf={conf:.2f} cat={'y' if cat else 'n'} det_off={off} votes={votes}/{n} xr={'y' if xr else 'n'}  {flags}")


if __name__ == "__main__":
    for fx in select(sys.argv[1:]):
        process(fx)
