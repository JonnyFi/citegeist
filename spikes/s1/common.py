"""Shared helpers for spike S1 (throwaway code)."""
import json
import re
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / "fixtures" / "pdf" / "cache"
MANIFEST = ROOT / "fixtures" / "pdf" / "manifest.json"
OUT = Path(__file__).resolve().parent / "out"


def load_manifest():
    return json.loads(MANIFEST.read_text())["fixtures"]


def pdf_path(fx):
    return CACHE / f"{fx['id']}.pdf"


def out_dir(fx):
    d = OUT / fx["id"]
    d.mkdir(parents=True, exist_ok=True)
    return d


def is_scan(fx):
    return "no-text-layer" in fx["kind"]


def norm(s: str) -> str:
    """Aggressive normalisation for text search: NFKC, lower case, only letters and digits."""
    s = unicodedata.normalize("NFKC", s).lower().replace("­", "")
    return re.sub(r"[\W_]+", "", s)


def select(argv):
    fx = load_manifest()
    ids = [a for a in argv if not a.startswith("--")]
    return [f for f in fx if not ids or f["id"] in ids]
