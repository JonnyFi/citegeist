"""Shared test setup.

Environment: models live in a machine-local cache (`CITEGEIST_MODELS_DIR`, default `~/.cache/citegeist-test-models`),
GROBID and formula enrichment are off unless a test turns them on. Fixture PDFs come from `fixtures/pdf` and are fetched
with `node fixtures/pdf/fetch.mjs`; tests that need a fixture, the network or the models skip when they are unavailable.
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[3]
FIXTURE_DIR = ROOT / "fixtures" / "pdf"
CACHE = FIXTURE_DIR / "cache"
HERE = Path(__file__).resolve().parent

os.environ.setdefault("CITEGEIST_MODELS_DIR", str(Path.home() / ".cache" / "citegeist-test-models"))
os.environ["CITEGEIST_GROBID"] = os.environ.get("CITEGEIST_TEST_GROBID", "off")
os.environ.setdefault("CITEGEIST_FORMULAS", "off")

# Fast set: small documents that exercise two columns, catalog labels, header/footer labels, Crossref offsets and OCR.
FAST = {
    "nomos-huntington-review-1970",
    "merz-bne-2021",
    "tacl-natural-questions-2019",
    "scan-ochtendung-urkunde-1958",
}


def manifest_fixtures() -> list[dict]:
    return json.loads((FIXTURE_DIR / "manifest.json").read_text())["fixtures"]


_fetched: dict[str, Path | None] = {}


def fixture_pdf(fid: str) -> Path:
    """Path of a fixture PDF, fetched on demand. Skips the test when it cannot be had."""
    if fid not in _fetched:
        fx = next(f for f in manifest_fixtures() if f["id"] == fid)
        path = CACHE / f"{fid}.pdf"
        ok = path.exists() and hashlib.sha256(path.read_bytes()).hexdigest() == fx["sha256"]
        if not ok:
            node = shutil.which("node")
            if node:
                subprocess.run([node, str(FIXTURE_DIR / "fetch.mjs"), fid], capture_output=True, timeout=300, check=False)
            ok = path.exists() and hashlib.sha256(path.read_bytes()).hexdigest() == fx["sha256"]
        _fetched[fid] = path if ok else None
    if _fetched[fid] is None:
        pytest.skip(f"fixture {fid} unavailable (offline or node missing): run `node fixtures/pdf/fetch.mjs`")
    return _fetched[fid]  # type: ignore[return-value]


@pytest.fixture(scope="session")
def models_ready() -> None:
    from citegeist_convert import models

    try:
        models.ensure_docling_models()
    except Exception as e:  # noqa: BLE001
        pytest.skip(f"Docling models unavailable (offline?): {e}")


_converted: dict[tuple, Path] = {}


@pytest.fixture(scope="session")
def convert_fixture(models_ready, tmp_path_factory):
    """convert_fixture(id, tag="a", previous=None) -> output directory of a conversion (cached per session)."""
    from citegeist_convert import convert

    def run(fid: str, tag: str = "a", previous: Path | None = None) -> Path:
        key = (fid, tag)
        if key in _converted:
            return _converted[key]
        pdf = fixture_pdf(fid)
        fx = next(f for f in manifest_fixtures() if f["id"] == fid)
        out = tmp_path_factory.mktemp(f"{fid}-{tag}")
        params = {
            "sourcePath": str(pdf),
            "source": hashlib.sha256(pdf.read_bytes()).hexdigest()[:12],
            "outDir": str(out),
            "kind": "pdf",
            "languages": [fx["language"], "en"] if fx["language"] != "en" else ["en"],
        }
        if fx.get("crossrefPages"):
            params["pageRangeHint"] = fx["crossrefPages"]
        if previous is not None:
            params["previousBlocks"] = str(previous / "blocks.jsonl")
        convert.run(params)
        _converted[key] = out
        return out

    return run
