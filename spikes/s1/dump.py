"""Print the first N blocks of a document in document order, compact, for manual reading-order inspection."""
import json
import sys

from common import out_dir, select

N = 30
args = [a for a in sys.argv[1:] if not a.startswith("--")]
sub = "ocr" if "--ocr" in sys.argv else ("formulas" if "--formulas" in sys.argv else "")
for fx in select(args):
    p = out_dir(fx) / sub / "blocks.jsonl"
    print("==", fx["id"])
    for i, l in enumerate(open(p)):
        if i >= N:
            break
        b = json.loads(l)
        x0, y0, x1, y1 = b["bbox"]
        t = " ".join(b["text"].split())[:52]
        print(f"{i:2d} p{b['page']} {b['type'][:9]:9s} {b['flow'][0]} x{x0:4.0f}-{x1:4.0f} y{y1:4.0f} | {t}")
