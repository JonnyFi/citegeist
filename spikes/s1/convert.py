"""Run Docling on every fixture and write raw blocks.jsonl (labels are added by labels.py).

usage: uv run python convert.py [--formulas] [--ocr] [id ...]
  --formulas  enable formula enrichment (CodeFormula model), output goes to out/<id>/formulas/
  --ocr       force full-page OCR (Apple Vision via ocrmac) even for PDFs with a text layer, output to out/<id>/ocr/
Scans (kind no-text-layer) always use full-page OCR.
"""
import hashlib
import json
import sys
import time

import pypdf
from docling.datamodel.base_models import InputFormat
from docling.datamodel.pipeline_options import OcrMacOptions, OcrMode, PdfPipelineOptions
from docling.document_converter import DocumentConverter, PdfFormatOption
from docling_core.types.doc import ContentLayer, DocItemLabel

from common import is_scan, out_dir, pdf_path, select

FORMULAS = "--formulas" in sys.argv
FORCE_OCR = "--ocr" in sys.argv

TYPE_MAP = {
    DocItemLabel.TITLE: "title",
    DocItemLabel.SECTION_HEADER: "heading",
    DocItemLabel.TEXT: "paragraph",
    DocItemLabel.PARAGRAPH: "paragraph",
    DocItemLabel.LIST_ITEM: "list_item",
    DocItemLabel.CAPTION: "caption",
    DocItemLabel.FOOTNOTE: "footnote",
    DocItemLabel.PAGE_HEADER: "page_header",
    DocItemLabel.PAGE_FOOTER: "page_footer",
    DocItemLabel.FORMULA: "formula",
    DocItemLabel.CODE: "code",
    DocItemLabel.TABLE: "table",
    DocItemLabel.PICTURE: "figure",
    DocItemLabel.REFERENCE: "reference",
}


def make_converter(ocr: bool, formulas: bool) -> DocumentConverter:
    opts = PdfPipelineOptions()
    opts.do_ocr = ocr
    opts.do_table_structure = True
    opts.do_formula_enrichment = formulas
    if ocr:
        opts.ocr_options = OcrMacOptions(lang=["de-DE", "en-US"], recognition="accurate", framework="vision", mode=OcrMode.FULL_PAGE)
    return DocumentConverter(format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=opts)})


def to_pdf_space(bbox, page_h):
    """Docling bbox -> [x0, y0, x1, y1] in PDF user space (origin bottom-left, points)."""
    b = bbox.to_bottom_left_origin(page_h) if bbox.coord_origin.value != "BOTTOMLEFT" else bbox
    return [round(b.l, 1), round(b.b, 1), round(b.r, 1), round(b.t, 1)]


def blocks_from_doc(doc):
    blocks = []
    layers = {ContentLayer.BODY, ContentLayer.FURNITURE}
    for item, _lvl in doc.iterate_items(included_content_layers=layers, with_groups=False):
        if not getattr(item, "prov", None):
            continue
        label = item.label
        btype = TYPE_MAP.get(label, str(label.value))
        if btype == "table":
            try:
                text = item.export_to_markdown(doc)
            except Exception:
                text = ""
        else:
            text = getattr(item, "text", "") or ""
        spans = []
        for pv in item.prov:
            ph = doc.pages[pv.page_no].size.height
            spans.append({"page": pv.page_no - 1, "start": pv.charspan[0], "end": pv.charspan[1], "bbox": to_pdf_space(pv.bbox, ph)})
        first = spans[0]
        key = f"{first['page']}|{first['bbox']}|{text[:80]}"
        blocks.append({
            "id": "b" + hashlib.sha1(key.encode()).hexdigest()[:7],
            "type": btype,
            "flow": "furniture" if item.content_layer == ContentLayer.FURNITURE else "body",
            "page": first["page"],
            "label": None,
            "bbox": first["bbox"],
            "text": text,
            "spans": spans,
            "src": {"engine": "docling@2.142.1", "native": item.self_ref},
        })
    return blocks


def main():
    fixtures = select(sys.argv[1:])
    sub = "formulas" if FORMULAS else ("ocr" if FORCE_OCR else "")
    conv_digital = make_converter(False, FORMULAS) if not FORCE_OCR else None
    conv_ocr = None
    warmed = False
    for fx in fixtures:
        scan = is_scan(fx)
        if FORMULAS and "math-heavy" not in fx["kind"]:
            continue
        if FORCE_OCR and not (scan or "noisy-text-layer" in fx["kind"]):
            continue
        if scan or FORCE_OCR:
            if conv_ocr is None:
                conv_ocr = make_converter(True, False)
                t0 = time.perf_counter()
                conv_ocr.convert(pdf_path(fx), page_range=(1, 1))
                print(f"warm-up (OCR pipeline, 1 page, includes model load): {time.perf_counter()-t0:.1f} s", flush=True)
            conv = conv_ocr
        else:
            if not warmed:
                t0 = time.perf_counter()
                conv_digital.convert(pdf_path(fx), page_range=(1, 1))
                print(f"warm-up (digital pipeline, 1 page, includes model load): {time.perf_counter()-t0:.1f} s", flush=True)
                warmed = True
            conv = conv_digital
        od = out_dir(fx) / sub
        od.mkdir(parents=True, exist_ok=True)
        path = pdf_path(fx)
        npages = len(pypdf.PdfReader(path).pages)
        t0 = time.perf_counter()
        res = conv.convert(path)
        dt = time.perf_counter() - t0
        doc = res.document
        blocks = blocks_from_doc(doc)
        with open(od / "blocks.jsonl", "w") as f:
            for b in blocks:
                f.write(json.dumps(b, ensure_ascii=False) + "\n")
        doc.save_as_json(od / "docling.json")
        meta = {"id": fx["id"], "variant": sub or ("ocr" if scan else "digital"), "pages": npages, "seconds": round(dt, 2),
                "sec_per_page": round(dt / npages, 3), "blocks": len(blocks), "status": str(res.status),
                "page_sizes": {str(k): [v.size.width, v.size.height] for k, v in doc.pages.items()}}
        (od / "convert_meta.json").write_text(json.dumps(meta, indent=1))
        print(f"{fx['id']:40s} {npages:3d} p  {dt:7.1f} s  {dt/npages:6.2f} s/p  {len(blocks):4d} blocks  {res.status}", flush=True)


if __name__ == "__main__":
    main()
