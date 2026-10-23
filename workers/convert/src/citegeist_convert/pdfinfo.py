"""Triage of a PDF with pypdf: page geometry, /PageLabels and the text layer."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from pathlib import Path

import pypdf

from . import quality
from .errors import ConvertError

logging.getLogger("pypdf").setLevel(logging.ERROR)


@dataclass
class PdfInfo:
    path: Path
    n_pages: int
    sizes: list[tuple[float, float]]
    rotations: list[int]
    catalog_labels: list[str] | None
    page_text: list[str]
    text_hit_rate: float | None
    text_words: int
    flags: list[str] = field(default_factory=list)

    @property
    def chars(self) -> int:
        return sum(len(t) for t in self.page_text)


def read(path: Path, languages: list[str]) -> PdfInfo:
    try:
        reader = pypdf.PdfReader(str(path))
        n = len(reader.pages)
    except Exception as e:
        raise ConvertError(
            "PDF_UNREADABLE",
            f"pypdf could not open {path.name}: {e}",
            "Check that the file is a valid, non-encrypted PDF, then retry.",
            recovery="ask-human",
            context={"path": str(path)},
        ) from e
    if reader.is_encrypted:
        try:
            reader.decrypt("")
        except Exception:
            raise ConvertError(
                "PDF_ENCRYPTED",
                f"{path.name} is password protected",
                "Remove the password and add the file again.",
                recovery="ask-human",
                context={"path": str(path)},
            ) from None
    sizes, rots, texts = [], [], []
    for page in reader.pages:
        box = page.mediabox
        sizes.append((float(box.width), float(box.height)))
        rots.append(int(page.rotation or 0) % 360)
        try:
            texts.append(page.extract_text() or "")
        except Exception:
            texts.append("")
    labels: list[str] | None = None
    try:
        if "/PageLabels" in reader.trailer["/Root"]:
            labels = [str(x) for x in reader.page_labels]
            if len(labels) != n:
                labels = None
    except Exception:
        labels = None
    body = " ".join(texts)
    rate, words = quality.hit_rate(body, languages)
    return PdfInfo(path, n, sizes, rots, labels, texts, rate, words)
