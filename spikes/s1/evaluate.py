"""Metrics for spike S1: page correctness, reading-order heuristic, label accuracy, speed.

usage: uv run python evaluate.py [id ...]  -> out/results.json and a markdown table on stdout
"""
import json
import logging
import sys
from collections import Counter

import pypdf

from common import OUT, is_scan, norm, out_dir, pdf_path, select

logging.disable(logging.CRITICAL)
TEXT_TYPES = {"paragraph", "heading", "list_item", "caption", "footnote", "title", "reference"}


def page_texts(path):
    r = pypdf.PdfReader(path)
    return [norm(p.extract_text() or "") for p in r.pages]


def page_correctness(blocks, texts):
    ok = wrong = unver = 0
    wrong_examples = []
    for b in blocks:
        if b["flow"] != "body" or b["type"] not in TEXT_TYPES:
            continue
        t = norm(b["text"])
        if len(t) < 25:
            continue
        snippets = [t[:24], t[-24:]]
        pages = {sp["page"] for sp in b["spans"]}
        on_own = any(s in texts[p] for s in snippets for p in pages)
        if on_own:
            ok += 1
            continue
        elsewhere = [i for i, tx in enumerate(texts) if any(s in tx for s in snippets)]
        if elsewhere:
            wrong += 1
            if len(wrong_examples) < 5:
                wrong_examples.append({"id": b["id"], "page": b["page"], "found_on": elsewhere[:3], "text": b["text"][:60]})
        else:
            unver += 1
    verified = ok + wrong
    return {"correct": ok, "wrong": wrong, "unverifiable": unver, "share_correct": round(ok / verified, 4) if verified else None, "wrong_examples": wrong_examples}


def order_check(blocks, sizes):
    """Heuristic: on pages with two text columns, every left-column block should precede every right-column block;
    inside a column, tops must not increase (PDF space, origin bottom)."""
    by_page = {}
    for i, b in enumerate(blocks):
        if b["flow"] == "body" and b["type"] in TEXT_TYPES | {"table", "figure"}:
            by_page.setdefault(b["page"], []).append(b)
    two_col_pages = bad_pages = 0
    for p, bl in by_page.items():
        w = sizes.get(str(p + 1), [595, 842])[0]
        cols = []
        for b in bl:
            x0, _, x1, _ = b["bbox"]
            width = x1 - x0
            if width > 0.62 * w:
                cols.append("F")
            else:
                cols.append("L" if (x0 + x1) / 2 < w / 2 else "R")
        nl, nr = cols.count("L"), cols.count("R")
        is_two = nl >= 3 and nr >= 3
        two_col_pages += is_two
        viol = False
        if is_two:
            seq = [c for c in cols if c != "F"]
            first_r = seq.index("R")
            if "L" in seq[first_r:]:
                viol = True
        for col in ("L", "R", "F"):
            tops = [b["bbox"][3] for b, c in zip(bl, cols) if c == col]
            if any(t2 > t1 + 20 for t1, t2 in zip(tops, tops[1:])):
                viol = True
        bad_pages += viol
    return {"pages_with_text": len(by_page), "two_col_pages": two_col_pages, "pages_with_order_violation": bad_pages}


def label_accuracy(fx, pages_json):
    first = fx["expected"]["firstPrintedPage"]
    n = len(pages_json["pages"])
    if first is None:
        return None
    gold = [str(first + i) for i in range(n)]
    res = {}
    final = [p["label"] for p in pages_json["pages"]]
    ok = sum(1 for g, l in zip(gold, final) if g == l)
    silent_wrong = sum(1 for g, p in zip(gold, pages_json["pages"]) if g != p["label"] and p["confidence"] >= 0.5)
    res["final"] = {"source": pages_json["pages"][0]["labelSource"], "confidence": pages_json["pages"][0]["confidence"], "correct": ok, "pages": n,
                    "share": round(ok / n, 3), "silently_wrong": silent_wrong}
    for name in ("catalog", "detected", "crossref"):
        lab = pages_json["sources"][name]["labels"]
        if lab is None:
            res[name] = None
        else:
            res[name] = {"correct": sum(1 for g, l in zip(gold, lab) if g == l), "pages": n}
    return res


def main():
    results = {}
    for fx in select(sys.argv[1:]):
        od = out_dir(fx)
        if not (od / "pages.json").exists():
            continue
        blocks = [json.loads(l) for l in open(od / "blocks.jsonl")]
        meta = json.load(open(od / "convert_meta.json"))
        pj = json.load(open(od / "pages.json"))
        r = {"pages": meta["pages"], "seconds": meta["seconds"], "sec_per_page": meta["sec_per_page"], "blocks": len(blocks),
             "types": dict(Counter(b["type"] for b in blocks))}
        if not is_scan(fx):
            r["page_correctness"] = page_correctness(blocks, page_texts(pdf_path(fx)))
        r["order_heuristic"] = order_check(blocks, meta["page_sizes"])
        r["labels"] = label_accuracy(fx, pj)
        r["label_flags"] = pj["flags"]
        results[fx["id"]] = r
    (OUT / "results.json").write_text(json.dumps(results, indent=1, ensure_ascii=False))
    print("| id | pages | s total | s/page | blocks | page ok | order viol/2col pages | label final (source, correct/pages) |")
    print("|---|---|---|---|---|---|---|---|")
    for k, r in results.items():
        pc = r.get("page_correctness")
        pcs = f"{pc['share_correct']:.1%} ({pc['correct']}/{pc['correct']+pc['wrong']}, {pc['unverifiable']} unverif.)" if pc and pc["share_correct"] is not None else "n/a"
        o = r["order_heuristic"]
        lb = r["labels"]
        lbs = f"{lb['final']['source']}, {lb['final']['correct']}/{lb['final']['pages']}, silent wrong {lb['final']['silently_wrong']}" if lb else "no gold"
        print(f"| {k} | {r['pages']} | {r['seconds']} | {r['sec_per_page']} | {r['blocks']} | {pcs} | {o['pages_with_order_violation']}/{o['two_col_pages']} | {lbs} |")


if __name__ == "__main__":
    main()
