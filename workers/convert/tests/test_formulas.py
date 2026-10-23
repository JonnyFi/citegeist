"""Formula enrichment runs only on pages that the layout model marks as containing formulas."""

from __future__ import annotations

import pypdf
import pytest
from conftest import fixture_pdf

from citegeist_convert import docling_pdf as dp


@pytest.mark.slow
@pytest.mark.network
def test_formula_enrichment_only_on_math_pages(models_ready, tmp_path, monkeypatch):
    src = fixture_pdf("arxiv-2312.00752-mamba")
    # pages 1 to 6 of the paper: the state space equations start on page 2, page 1 and 6 have none
    reader = pypdf.PdfReader(str(src))
    writer = pypdf.PdfWriter()
    for i in range(0, 6):
        writer.add_page(reader.pages[i])
    excerpt = tmp_path / "mamba-excerpt.pdf"
    with open(excerpt, "wb") as f:
        writer.write(f)

    ex = dp.convert_pdf(excerpt, ocr=False, languages=["en"], pictures=False)
    eq_pages = {b["spans"][0]["page"] for b in ex.blocks if b["type"] == "equation"}
    assert eq_pages and len(eq_pages) < 6, "some pages have formulas, some do not"
    assert all(not b.get("latex") for b in ex.blocks), "no enrichment in the first pass"

    sent = []
    real = dp.converter

    def spy(*args, **kwargs):
        conv = real(*args, **kwargs)
        if not kwargs.get("formulas"):
            return conv

        class Spy:
            def convert(self, path, **kw):
                sent.append(len(pypdf.PdfReader(path).pages))
                return conv.convert(path, **kw)

        return Spy()

    monkeypatch.setattr(dp, "converter", spy)
    monkeypatch.setenv("CITEGEIST_FORMULAS", "auto")
    filled = dp.enrich_formulas(excerpt, ex, ["en"])
    assert sent == [len(eq_pages)], "only the pages with formulas go through the formula model"
    assert filled >= 1
    with_latex = [b for b in ex.blocks if b.get("latex")]
    assert with_latex and all("\\" in b["latex"] or "=" in b["latex"] for b in with_latex)
    assert all(b["spans"][0]["end"] == len(b["text"]) for b in with_latex)
