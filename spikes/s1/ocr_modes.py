"""Compare Docling OCR modes on one scan: how much text survives layout assignment."""
import sys
import time

from docling.datamodel.base_models import InputFormat
from docling.datamodel.pipeline_options import OcrMacOptions, OcrMode, PdfPipelineOptions
from docling.document_converter import DocumentConverter, PdfFormatOption

from common import pdf_path, select

fx = select([sys.argv[1]])[0]
for mode in (OcrMode.DEFAULT, OcrMode.FULL_PAGE, OcrMode.LAYOUT_REGIONS):
    for scale in (3.0,):
        o = PdfPipelineOptions()
        o.do_ocr = True
        o.ocr_options = OcrMacOptions(lang=["de-DE", "en-US"], mode=mode, scale=scale)
        conv = DocumentConverter(format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=o)})
        t0 = time.perf_counter()
        r = conv.convert(pdf_path(fx), page_range=(1, 1))
        d = r.document
        txt = " ".join(t.text for t in d.texts)
        print(f"{mode.value:28s} scale={scale} {time.perf_counter()-t0:5.1f}s items={len(d.texts)} chars={len(txt)}")
