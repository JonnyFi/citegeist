"""The convert pipeline: triage, extraction per path, labels, ids, outputs."""

from __future__ import annotations

import json
import logging
import os
import re
import shutil
import sys
import time
from datetime import UTC, datetime
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
from typing import Any

from . import VERSION, arxiv, grobid, ids, labels, log, pdfinfo, quality, refs, render, web
from . import docling_pdf as dp
from . import schemas as sch
from .errors import ConvertError

_log = logging.getLogger(__name__)
LOW_QUALITY = quality.GATE
MIN_SCAN_CHARS_PER_PAGE = 40  # S1: a scan with a watermark carries 23 characters


def _ver(pkg: str) -> str:
    try:
        return version(pkg)
    except PackageNotFoundError:
        return "unknown"


def _atomic(path: Path, text: str) -> None:
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)


def _strip_internal(block: dict[str, Any]) -> dict[str, Any]:
    out = {"id": block["id"]}
    out.update({k: v for k, v in block.items() if not k.startswith("_") and k != "id"})
    return out


def assign_sections(blocks: list[dict[str, Any]]) -> None:
    """`sec` is the outline path of the enclosing heading ("3.2"), computed from the heading levels.

    Run-in headings (level 4 and deeper, "Selection Mechanism.") do not open a numbered section.
    """
    counters: list[int] = []
    current: str | None = None
    for b in blocks:
        if b["flow"] == "body" and b["type"] == "heading" and "_num" in b and int(b.get("_level", 1)) <= 3:
            # The source numbers its sections itself (LaTeXML tags): use the printed number.
            num = re.sub(r"^(appendix|section|chapter)\s+", "", b["_num"].strip().rstrip("."), flags=re.I)
            current = num if re.fullmatch(r"[A-Z0-9]+(\.\d+)*", num) else None
        elif b["flow"] == "body" and b["type"] == "heading" and int(b.get("_level", 1)) <= 3:
            level = max(1, int(b.get("_level", 1)))
            while len(counters) < level - 1:  # skipped levels count as 1
                counters.append(1)
            if len(counters) < level:
                counters.append(0)
            del counters[level:]
            counters[level - 1] += 1
            current = ".".join(str(c) for c in counters)
        if current and b["type"] != "title":
            b["sec"] = current


def _page_quality(blocks: list[dict[str, Any]], n: int, languages: list[str]) -> list[float | None]:
    texts: list[list[str]] = [[] for _ in range(n)]
    for b in blocks:
        if b["flow"] != "body" or b["type"] not in ("paragraph", "heading", "list-item", "caption", "footnote", "title"):
            continue
        for sp in b["spans"]:
            if sp["page"] < n and sp["end"] > sp["start"]:
                texts[sp["page"]].append(b["text"][sp["start"] : sp["end"]])
    out: list[float | None] = []
    for t in texts:
        rate, words = quality.hit_rate(" ".join(t), languages)
        out.append(round(rate, 3) if rate is not None and words >= 15 else None)
    return out


def _decide_path(info: pdfinfo.PdfInfo, ocr: str) -> str:
    if ocr == "force":
        return "scan"
    if ocr == "off":
        return "digital"
    if info.chars < MIN_SCAN_CHARS_PER_PAGE * max(1, info.n_pages):
        return "scan"
    if info.text_hit_rate is not None and info.text_words >= 50 and info.text_hit_rate < LOW_QUALITY:
        return "scan"
    return "digital"


def _band_blocks(info: pdfinfo.PdfInfo) -> list[dict[str, Any]]:
    """Header and footer candidates from the text layer (first and last lines of every page)."""
    out = []
    for i, text in enumerate(info.page_text):
        lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
        w, h = info.sizes[i]
        for ln in lines[:2]:
            out.append(_furn(ln, i, [0, h - 1, w, h]))
        for ln in lines[-2:]:
            out.append(_furn(ln, i, [0, 0, w, 1]))
    return out


def _furn(text: str, page: int, bbox: list[float]) -> dict[str, Any]:
    return {
        "type": "page-furniture",
        "flow": "furniture",
        "text": text,
        "spans": [{"page": page, "label": None, "start": 0, "end": len(text), "bbox": bbox}],
    }


def _page_entries(
    n: int,
    sizes: list[tuple[float, float]],
    rotations: list[int],
    res: labels.LabelResult | None,
    text_source: str,
    page_quality: list[float | None] | None,
) -> list[dict[str, Any]]:
    pages = []
    for i in range(n):
        p: dict[str, Any] = {
            "index": i,
            "label": res.labels[i] if res else None,
            "labelSource": res.label_source if res else "none",
            "width": round(sizes[i][0], 2),
            "height": round(sizes[i][1], 2),
            "rotation": rotations[i] if rotations[i] in (0, 90, 180, 270) else 0,
            "textSource": text_source,
            "labelConfidence": res.confidence[i] if res else 0.0,
        }
        if page_quality and page_quality[i] is not None:
            p["quality"] = page_quality[i]
        pages.append(p)
    return pages


def _validate_blocks(blocks: list[dict[str, Any]]) -> None:
    for b in blocks:
        errs = sch.errors("block", b)
        if errs:
            raise ConvertError(
                "OUTPUT_INVALID",
                f"block {b.get('id')} violates the Block schema: {'; '.join(errs[:3])}",
                "This is a bug in the worker. Report it with the source file.",
                recovery="ask-human",
                context={"block": b.get("id")},
            )


def run(params: dict[str, Any]) -> dict[str, Any]:
    t0 = time.perf_counter()
    params = sch.convert_params_with_defaults(params)
    errs = sch.errors("worker-convert-params", params)
    if errs:
        raise ConvertError(
            "INVALID_PARAMS",
            "convert params violate WorkerConvertParams: " + "; ".join(errs[:4]),
            "Send sourcePath, source (12 hex chars), outDir and kind as specified in packages/schema/src/worker.ts.",
            recovery="fix-and-retry",
        )
    kind = params["kind"]
    src = Path(params["sourcePath"])
    out_dir = Path(params["outDir"])
    languages = params["languages"]
    if not src.is_file():
        raise ConvertError(
            "SOURCE_NOT_FOUND",
            f"sourcePath does not exist: {src}",
            "Pass the absolute path of the stored source file.",
            recovery="fix-and-retry",
            context={"sourcePath": str(src)},
        )
    if kind == "epub":
        raise ConvertError(
            "UNSUPPORTED_KIND",
            "kind=epub is not implemented in the conversion worker yet",
            "Convert the EPUB to PDF or HTML first, or add the file as a web page.",
            recovery="ask-human",
        )
    previous: list[dict[str, Any]] = []
    flags: list[str] = []
    prev_path = params.get("previousBlocks")
    if prev_path:
        if Path(prev_path).is_file():
            previous = ids.load_blocks(prev_path)
        else:
            flags.append("previous-blocks-missing")
    out_dir.mkdir(parents=True, exist_ok=True)
    source = params["source"]
    tools: dict[str, str] = {"citegeist-convert": VERSION, "python": sys.version.split()[0]}
    header: dict[str, Any] | None = None
    reference_entries: list[dict[str, Any]] = []
    images: dict[int, Any] = {}

    if kind == "pdf":
        info = pdfinfo.read(src, languages)
        tools["pypdf"] = _ver("pypdf")
        path = _decide_path(info, params["ocr"])
        is_ocr = path == "scan"
        if is_ocr:
            flags.append("ocr")
            tools["ocr"] = f"apple-vision (ocrmac {_ver('ocrmac')})" if sys.platform == "darwin" else "rapidocr"
        ex = dp.convert_pdf(src, ocr=is_ocr, languages=languages)
        tools["docling"] = _ver("docling")
        blocks = ex.blocks
        images = ex.images
        if not is_ocr:
            filled = dp.enrich_formulas(src, ex, languages)
            if filled:
                tools["formulas"] = f"CodeFormulaV2 on {filled} formula(s)"
        n = info.n_pages
        sizes = [ex.page_sizes.get(i, info.sizes[i]) for i in range(n)]
        page_q = _page_quality(blocks, n, languages)
        if is_ocr:
            # OCR pages without enough recognisable words count as unreadable, not as unknown.
            low = [i for i, q in enumerate(page_q) if q is None or q < LOW_QUALITY]
            if low:
                flags.append("low-quality")
                flags.append(f"low-quality-pages:{','.join(str(i) for i in low)}")
            for b in blocks:
                q = page_q[b["spans"][0]["page"]] if b["spans"] else None
                if q is not None:
                    b["conf"] = q
        doc_rate, doc_words = quality.hit_rate(
            " ".join(b["text"] for b in blocks if b["flow"] == "body" and b["type"] in ("paragraph", "heading", "list-item")),
            languages,
        )
        lab = labels.compute(n, info.catalog_labels, blocks, sizes, params.get("pageRangeHint"), doc_rate, doc_words)
        flags += [f"labels:{f}" for f in lab.flags if "low" in f]
        if max(lab.confidence, default=0.0) < 0.5:
            flags.append("labels-need-confirmation")
        pages = _page_entries(n, sizes, info.rotations, lab, "ocr" if is_ocr else "born-digital", page_q)
        manifest_path = "scan" if is_ocr else "digital"
        title_hint = next((b["text"] for b in blocks if b["type"] == "title"), src.stem)
        if not is_ocr:
            result = grobid.process(src)
            if result is None:
                flags.append("grobid-unavailable")
            elif "error" in result:
                flags.append("grobid-failed")
            else:
                tools["grobid"] = result["version"]
                header = result["header"]
                reference_entries = result["references"]
        ref_idx = refs.mark_reference_blocks(blocks)
        ref_source = "docling"
    elif kind == "arxiv-html":
        blocks, ref_list, doc_title = arxiv.parse(src)
        tools["latexml-cleanup"] = _ver("lxml")
        pdf_param = params.get("pdfPath")
        pdf_path = Path(pdf_param) if pdf_param else next(
            (c for c in (src.with_suffix(".pdf"), Path(str(src) + ".pdf")) if c.is_file()), None
        )
        reference_entries = ref_list
        if pdf_path and pdf_path.is_file():
            info = pdfinfo.read(pdf_path, languages)
            tools["pypdf"] = _ver("pypdf")
            stats = arxiv.map_pages(blocks, pdf_path, info.page_text)
            tools["page-mapping"] = f"pdf named destinations ({stats['anchors']} anchors) and text search"
            n = info.n_pages
            sizes = info.sizes
            lab = labels.compute(
                n, info.catalog_labels, _band_blocks(info), sizes, params.get("pageRangeHint"), None, 0
            )
            if max(lab.confidence, default=0.0) < 0.5:
                flags.append("labels-need-confirmation")
            pages = _page_entries(n, sizes, info.rotations, lab, "html", None)
        else:
            flags.append("no-pdf-for-page-mapping")
            n = 1
            lab = None
            pages = _page_entries(1, [(612.0, 792.0)], [0], None, "html", None)
        manifest_path = "arxiv"
        title_hint = doc_title or src.stem
        header = {"title": doc_title, "source": "latexml"}
        ref_idx = []
        ref_source = "latexml"
    else:  # web
        blocks, meta = web.parse(src)
        tools["trafilatura"] = _ver("trafilatura")
        n = 1
        lab = None
        pages = _page_entries(1, [(612.0, 792.0)], [0], None, "html", None)
        flags.append("no-pages")
        manifest_path = "web"
        title_hint = meta.get("title") or src.stem
        header = {k: v for k, v in meta.items() if v}
        ref_idx = []
        ref_source = "web"
        if meta.get("language"):
            languages = [meta["language"]]

    # structure, labels on spans, ids ----------------------------------------------------------------
    assign_sections(blocks)
    page_labels = [p["label"] for p in pages]
    for b in blocks:
        for sp in b["spans"]:
            sp["label"] = page_labels[sp["page"]] if sp["page"] < len(page_labels) else None
    idmap = ids.assign_ids(source, blocks, previous)
    if previous:
        kept = ids.retention(idmap)
        flags.append(f"id-retention:{kept:.3f}")
    if kind == "pdf" and not reference_entries:
        reference_entries = refs.from_blocks(blocks, ref_idx, ref_source)

    # outputs --------------------------------------------------------------------------------------
    assets: dict[str, str] = {}
    stage = out_dir / f".stage-{os.getpid()}"
    shutil.rmtree(stage, ignore_errors=True)
    (stage / "assets").mkdir(parents=True)
    for idx, img in images.items():
        bid = blocks[idx]["id"]
        try:
            img.save(stage / "assets" / f"{bid}.png")
            assets[bid] = f"assets/{bid}.png"
        except Exception:
            _log.warning("could not save figure %s", bid)
    clean = [_strip_internal(b) for b in blocks]
    _validate_blocks(clean)
    pages_doc = {
        "source": source,
        "pages": pages,
        "confirmed": False,
        "labelFlags": lab.flags if lab else [],
        "furniture": lab.furniture_runs if lab else [],
        "pageRangeHint": params.get("pageRangeHint"),
    }
    sch.validate("pages", pages_doc)
    sch.validate("idmap", idmap)
    lang = languages[0] if languages else "en"
    _atomic(stage / "blocks.jsonl", "".join(json.dumps(b, ensure_ascii=False) + "\n" for b in clean))
    _atomic(stage / "pages.json", json.dumps(pages_doc, ensure_ascii=False, indent=1) + "\n")
    _atomic(stage / "idmap.json", json.dumps(idmap, indent=1) + "\n")
    _atomic(
        stage / "refs.jsonl",
        "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in reference_entries),
    )
    _atomic(stage / "doc.md", render.render_md(blocks, pages, assets))
    _atomic(stage / "doc.html", render.render_html(blocks, pages, assets, title_hint, lang, source))
    if header:
        _atomic(stage / "header.json", json.dumps(header, ensure_ascii=False, indent=1) + "\n")
    now = datetime.now(UTC)
    manifest = {
        "source": source,
        "path": manifest_path,
        "tools": tools,
        "createdAt": now.strftime("%Y-%m-%dT%H:%M:%S.") + f"{now.microsecond // 1000:03d}Z",
        "durationMs": round((time.perf_counter() - t0) * 1000),
        "flags": flags,
    }
    sch.validate("derived-manifest", manifest)
    _atomic(stage / "manifest.json", json.dumps(manifest, indent=1) + "\n")
    # Move into place. The manifest goes last: its presence marks a complete conversion.
    shutil.rmtree(out_dir / "assets", ignore_errors=True)
    os.replace(stage / "assets", out_dir / "assets")
    if not header and (out_dir / "header.json").exists():
        (out_dir / "header.json").unlink()
    for name in ("blocks.jsonl", "pages.json", "idmap.json", "refs.jsonl", "doc.md", "doc.html", "header.json"):
        if (stage / name).exists():
            os.replace(stage / name, out_dir / name)
    os.replace(stage / "manifest.json", out_dir / "manifest.json")
    shutil.rmtree(stage, ignore_errors=True)
    log.progress(f"Converted {src.name}: {len(blocks)} blocks, {n} page(s)", 1.0)
    return manifest
