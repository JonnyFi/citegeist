"""PDF to blocks with Docling: digital path (OCR off) and scan path (Apple Vision OCR)."""

from __future__ import annotations

import logging
import os
import sys
import tempfile
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import pypdf

from . import log, models
from .errors import ConvertError

_log = logging.getLogger(__name__)
SOFT_HYPHEN = "­"
VISION_LANGS = {
    "de": "de-DE",
    "en": "en-US",
    "fr": "fr-FR",
    "it": "it-IT",
    "es": "es-ES",
    "pt": "pt-BR",
    "ru": "ru-RU",
    "uk": "uk-UA",
    "ja": "ja-JP",
    "ko": "ko-KR",
    "zh": "zh-Hans",
}
_converters: dict[str, Any] = {}
_lock = threading.Lock()


@dataclass
class Extracted:
    blocks: list[dict[str, Any]]
    page_sizes: dict[int, tuple[float, float]]
    engine: str
    images: dict[int, Any] = field(default_factory=dict)  # block index to PIL image


def engine_version() -> str:
    from importlib.metadata import version

    return f"docling@{version('docling')}"


def _options(ocr: bool, languages: list[str], formulas: bool, pictures: bool):
    from docling.datamodel.pipeline_options import (
        OcrAutoOptions,
        PdfPipelineOptions,
    )

    opts = PdfPipelineOptions()
    opts.artifacts_path = str(models.ensure_docling_models())
    opts.do_ocr = ocr
    opts.do_table_structure = True
    opts.do_formula_enrichment = formulas
    if pictures:
        opts.generate_picture_images = True
        opts.images_scale = 1.5
    if ocr:
        if sys.platform == "darwin":
            from docling.datamodel.pipeline_options import OcrMacOptions, OcrMode

            langs = [VISION_LANGS[lang.split("-")[0]] for lang in languages if lang.split("-")[0] in VISION_LANGS]
            opts.ocr_options = OcrMacOptions(
                lang=langs or ["en-US"],
                recognition="accurate",
                framework="vision",
                mode=OcrMode.FULL_PAGE,
            )
        else:
            opts.ocr_options = OcrAutoOptions()
    if formulas:
        models.ensure_formula_model()
    return opts


def converter(ocr: bool, languages: list[str], formulas: bool = False, pictures: bool = True):
    from docling.datamodel.base_models import InputFormat
    from docling.document_converter import DocumentConverter, PdfFormatOption

    key = f"{ocr}|{','.join(languages) if ocr else ''}|{formulas}|{pictures}"
    with _lock:
        if key not in _converters:
            log.progress("Loading conversion models")
            opts = _options(ocr, languages, formulas, pictures)
            _converters[key] = DocumentConverter(
                format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=opts)}
            )
        return _converters[key]


def _type_map():
    from docling_core.types.doc import DocItemLabel as L

    return {
        L.TITLE: ("title", "body"),
        L.SECTION_HEADER: ("heading", "body"),
        L.TEXT: ("paragraph", "body"),
        L.PARAGRAPH: ("paragraph", "body"),
        L.LIST_ITEM: ("list-item", "body"),
        L.CAPTION: ("caption", "body"),
        L.FOOTNOTE: ("footnote", "notes"),
        L.PAGE_HEADER: ("page-furniture", "furniture"),
        L.PAGE_FOOTER: ("page-furniture", "furniture"),
        L.FORMULA: ("equation", "body"),
        L.CODE: ("code", "body"),
        L.TABLE: ("table", "body"),
        L.DOCUMENT_INDEX: ("table", "body"),
        L.PICTURE: ("figure", "body"),
        L.CHART: ("figure", "body"),
        L.REFERENCE: ("reference", "body"),
    }


def _to_pdf_space(bbox, page_h: float) -> list[float]:
    b = bbox.to_bottom_left_origin(page_h) if bbox.coord_origin.value != "BOTTOMLEFT" else bbox
    return [round(b.l, 2), round(b.b, 2), round(b.r, 2), round(b.t, 2)]


def _union(boxes: list[list[float]]) -> list[float]:
    return [
        min(b[0] for b in boxes),
        min(b[1] for b in boxes),
        max(b[2] for b in boxes),
        max(b[3] for b in boxes),
    ]


def _clean(s: str) -> str:
    return s.replace(SOFT_HYPHEN, "")


def _spans_and_text(item, doc, text: str, is_text: bool) -> tuple[str, list[dict[str, Any]]]:
    """Build spans (one per provenance entry) with offsets into the cleaned text."""
    provs = list(item.prov)
    pieces: list[tuple[int, list[float], str]] = []
    heights = {pv.page_no: doc.pages[pv.page_no].size.height for pv in provs}
    boxes = [(pv.page_no - 1, _to_pdf_space(pv.bbox, heights[pv.page_no])) for pv in provs]
    spans_ok = is_text and len(provs) > 1 and text
    if spans_ok:
        cs = [tuple(pv.charspan) for pv in provs]
        starts = [c[0] for c in cs]
        spans_ok = starts[0] == 0 and starts == sorted(starts) and len(set(starts)) == len(starts) and cs[-1][1] <= len(text)
    if spans_ok:
        bounds = [c[0] for c in cs[1:]] + [len(text)]
        for (page, box), end, start in zip(boxes, bounds, [c[0] for c in cs], strict=True):
            pieces.append((page, box, _clean(text[start:end])))
    else:
        # One span for the whole text. Multiple provenance entries on the same page are merged,
        # entries on other pages keep an empty-range span so that the pages still show up.
        page0 = boxes[0][0]
        same = [b for p, b in boxes if p == page0]
        pieces.append((page0, _union(same), _clean(text)))
        for page in dict.fromkeys(p for p, _ in boxes if p != page0):
            pieces.append((page, _union([b for p, b in boxes if p == page]), ""))
    out_text = "".join(p[2] for p in pieces)
    spans = []
    pos = 0
    for page, box, seg in pieces:
        spans.append({"page": page, "label": None, "start": pos, "end": pos + len(seg), "bbox": box})
        pos += len(seg)
    return out_text, spans


def _table_text(item, doc) -> tuple[str, str, str]:
    """Flat cell text, HTML and Markdown of a table."""
    try:
        md = item.export_to_markdown(doc)
    except Exception:
        md = ""
    try:
        html = item.export_to_html(doc)
    except Exception:
        html = ""
    flat = []
    try:
        grid = item.data.grid
        for row in grid:
            cells = []
            seen = set()
            for c in row:
                key = (c.start_row_offset_idx, c.start_col_offset_idx)
                if key in seen:
                    continue
                seen.add(key)
                cells.append(_clean(c.text or "").strip())
            flat.append(" | ".join(cells))
    except Exception:
        flat = []
    return "\n".join(flat), html, md


def blocks_from_doc(doc, engine: str, want_images: bool) -> Extracted:
    from docling_core.types.doc import ContentLayer, DocItemLabel

    tmap = _type_map()
    layers = {ContentLayer.BODY, ContentLayer.FURNITURE}
    blocks: list[dict[str, Any]] = []
    images: dict[int, Any] = {}
    for item, _lvl in doc.iterate_items(included_content_layers=layers, with_groups=False):
        if not getattr(item, "prov", None):
            continue
        btype, flow = tmap.get(item.label, ("paragraph", "body"))
        if item.content_layer == ContentLayer.FURNITURE:
            btype, flow = "page-furniture", "furniture"
        html = None
        md = None
        if btype == "table":
            text, html, md = _table_text(item, doc)
            text = text or ""
            spans = [
                {"page": pv.page_no - 1, "label": None, "start": 0, "end": len(text), "bbox": _to_pdf_space(pv.bbox, doc.pages[pv.page_no].size.height)}
                for pv in item.prov[:1]
            ]
        else:
            raw = getattr(item, "text", "") or ""
            text, spans = _spans_and_text(item, doc, raw, is_text=True)
        if not text.strip() and btype not in ("figure", "table", "equation"):
            continue
        if btype == "table" and not text.strip() and not html:
            continue
        block: dict[str, Any] = {
            "type": btype,
            "flow": flow,
            "text": text,
            "spans": spans,
            "src": {"engine": engine, "native": item.self_ref},
        }
        if html:
            block["html"] = html
        if md:
            block["_md"] = md
        if item.label == DocItemLabel.SECTION_HEADER:
            block["_level"] = int(getattr(item, "level", 1) or 1)
        if item.label == DocItemLabel.TITLE:
            block["_level"] = 0
        if btype == "list-item":
            block["_marker"] = getattr(item, "marker", None)
            block["_enumerated"] = bool(getattr(item, "enumerated", False))
        if btype == "code":
            block["_lang"] = str(getattr(getattr(item, "code_language", None), "value", "") or "")
        if want_images and btype == "figure":
            try:
                img = item.get_image(doc)
                if img is not None:
                    images[len(blocks)] = img
            except Exception:
                _log.debug("no image for %s", item.self_ref)
        blocks.append(block)
    sizes = {k - 1: (v.size.width, v.size.height) for k, v in doc.pages.items()}
    return Extracted(blocks, sizes, engine, images)


def convert_pdf(
    path: Path,
    *,
    ocr: bool,
    languages: list[str],
    pictures: bool = True,
) -> Extracted:
    conv = converter(ocr, languages, pictures=pictures)
    log.progress(f"Converting {path.name} with Docling" + (" and Apple Vision OCR" if ocr else ""))
    try:
        res = conv.convert(str(path), raises_on_error=True)
    except Exception as e:
        raise ConvertError(
            "DOCLING_FAILED",
            f"Docling failed on {path.name}: {type(e).__name__}: {e}",
            "Check the stderr log of the worker. Retry with ocr=force if the PDF has a broken text layer.",
            recovery="fix-and-retry",
            context={"path": str(path), "ocr": ocr},
        ) from e
    return blocks_from_doc(res.document, engine_version(), pictures)


def formulas_enabled() -> bool:
    return os.environ.get("CITEGEIST_FORMULAS", "auto") != "off"


def enrich_formulas(path: Path, ex: Extracted, languages: list[str]) -> int:
    """Run formula enrichment only on pages that contain formula blocks. Returns the number of formulas filled."""
    pages = sorted({b["spans"][0]["page"] for b in ex.blocks if b["type"] == "equation" and b["spans"]})
    cap = int(os.environ.get("CITEGEIST_FORMULA_MAX_PAGES", "60"))
    if not pages or not formulas_enabled():
        return 0
    pages = pages[:cap]
    log.progress(f"Formula enrichment on {len(pages)} page(s) with math")
    reader = pypdf.PdfReader(str(path))
    writer = pypdf.PdfWriter()
    for p in pages:
        writer.add_page(reader.pages[p])
    with tempfile.TemporaryDirectory() as tmp:
        sub = Path(tmp) / "math-pages.pdf"
        with open(sub, "wb") as f:
            writer.write(f)
        conv = converter(False, languages, formulas=True, pictures=False)
        try:
            res = conv.convert(str(sub), raises_on_error=True)
        except Exception as e:
            _log.warning("formula enrichment failed: %s", e)
            return 0
    from docling_core.types.doc import DocItemLabel

    doc = res.document
    enriched = []
    for item, _ in doc.iterate_items(with_groups=False):
        if item.label != DocItemLabel.FORMULA or not item.prov:
            continue
        pv = item.prov[0]
        h = doc.pages[pv.page_no].size.height
        enriched.append((pages[pv.page_no - 1], _to_pdf_space(pv.bbox, h), (item.text or "").strip()))
    filled = 0
    taken: set[int] = set()
    for page, box, latex in enriched:
        if not latex:
            continue
        best, best_iou = None, 0.05
        for i, b in enumerate(ex.blocks):
            if b["type"] != "equation" or i in taken or not b["spans"] or b["spans"][0]["page"] != page:
                continue
            v = iou(box, b["spans"][0]["bbox"])
            if v > best_iou:
                best, best_iou = i, v
        if best is not None:
            taken.add(best)
            blk = ex.blocks[best]
            blk["latex"] = latex
            blk["text"] = latex
            blk["spans"][0]["end"] = len(latex)
            blk["spans"][0]["bbox"] = _union([blk["spans"][0]["bbox"], box])
            filled += 1
    return filled


def iou(a: list[float], b: list[float]) -> float:
    ix = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    if inter <= 0:
        return 0.0
    ua = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / ua if ua > 0 else 0.0
