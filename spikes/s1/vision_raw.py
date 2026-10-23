"""Raw Apple Vision OCR (via ocrmac) on a scan, bypassing Docling's layout stage.

usage: uv run python vision_raw.py <fixture id> [dpi]
Writes out/<id>/vision_raw.json with lines (text, confidence, bbox in PDF space) per page.
"""
import io
import json
import sys
import time

import pymupdf
from ocrmac import ocrmac
from PIL import Image

from common import out_dir, pdf_path, select

dpi = int(sys.argv[2]) if len(sys.argv) > 2 else 300
fx = select([sys.argv[1]])[0]
doc = pymupdf.open(pdf_path(fx))
res = []
t0 = time.perf_counter()
for i, page in enumerate(doc):
    pix = page.get_pixmap(dpi=dpi)
    img = Image.open(io.BytesIO(pix.tobytes("png")))
    ann = ocrmac.OCR(img, language_preference=["de-DE", "en-US"], recognition_level="accurate").recognize()
    w, h = page.rect.width, page.rect.height
    lines = []
    for text, conf, (x, y, bw, bh) in ann:  # normalised, origin bottom-left
        lines.append({"text": text, "conf": round(conf, 3), "bbox": [round(x * w, 1), round(y * h, 1), round((x + bw) * w, 1), round((y + bh) * h, 1)]})
    res.append({"page": i, "lines": lines})
dt = time.perf_counter() - t0
(out_dir(fx) / "vision_raw.json").write_text(json.dumps({"seconds": round(dt, 2), "dpi": dpi, "pages": res}, ensure_ascii=False, indent=1))
print(f"{fx['id']}: {len(doc)} pages, {dt:.1f} s, lines per page: {[len(p['lines']) for p in res]}")
for p in res[:1]:
    for l in p["lines"][:60]:
        print(l["conf"], [int(v) for v in l["bbox"]], l["text"])
