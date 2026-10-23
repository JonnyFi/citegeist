"""Machine-local model storage with pinned revisions and lazy download.

Models live under `$CITEGEIST_MODELS_DIR` (default `~/Library/Application Support/citegeist/models`),
never inside the library folder. Every download is pinned to a commit hash and reported through
`log.progress` so the core can show a progress message.
"""

from __future__ import annotations

import os
import threading
from pathlib import Path

from . import log

# (repo id, commit hash, approximate size in MB)
LAYOUT = ("docling-project/docling-layout-heron", "8f39ad3c0b4c58e9c2d2c84a38465abf757272d8", 330)
TABLEFORMER = ("docling-project/docling-models", "fc0f2d45e2218ea24bce5045f58a389aed16dc23", 680)
CODE_FORMULA = ("docling-project/CodeFormulaV2", "ecedbe111d15c2dc60bfd4a823cbe80127b58af4", 1200)

_lock = threading.Lock()


def models_dir() -> Path:
    env = os.environ.get("CITEGEIST_MODELS_DIR")
    base = Path(env) if env else Path.home() / "Library" / "Application Support" / "citegeist" / "models"
    base.mkdir(parents=True, exist_ok=True)
    return base


def _folder(repo_id: str) -> str:
    return repo_id.replace("/", "--")


def docling_artifacts() -> Path:
    return models_dir() / "docling"


def _complete(path: Path) -> bool:
    return (path / ".citegeist-complete").exists()


def _fetch(repo: tuple[str, str, int], target: Path) -> None:
    from huggingface_hub import snapshot_download

    repo_id, revision, size_mb = repo
    if _complete(target):
        return
    log.progress(f"Downloading model {repo_id} (about {size_mb} MB, revision {revision[:8]})", 0.0)
    snapshot_download(repo_id=repo_id, revision=revision, local_dir=target)
    (target / ".citegeist-complete").write_text(revision)
    log.progress(f"Model {repo_id} ready", 1.0)


def ensure_docling_models() -> Path:
    """Layout and table models for the PDF pipeline. Returns the Docling artifacts path."""
    root = docling_artifacts()
    with _lock:
        for repo in (LAYOUT, TABLEFORMER):
            _fetch(repo, root / _folder(repo[0]))
    return root


def ensure_formula_model() -> None:
    """The CodeFormulaV2 model (about 1.2 GB), fetched only when a page with math needs it."""
    with _lock:
        _fetch(CODE_FORMULA, docling_artifacts() / _folder(CODE_FORMULA[0]))


def docling_model_status() -> dict[str, str]:
    root = docling_artifacts()
    out = {}
    for repo in (LAYOUT, TABLEFORMER):
        ok = _complete(root / _folder(repo[0]))
        out[repo[0]] = f"{repo[1][:8]} {'installed' if ok else 'not installed'}"
    return out
