"""Logging and progress. stdout belongs to JSON-RPC, so everything human readable goes to stderr."""

from __future__ import annotations

import logging
import sys
import threading
from collections.abc import Callable

_lock = threading.Lock()
_progress_sink: Callable[[str, float | None], None] | None = None


def setup_logging() -> None:
    logging.basicConfig(
        stream=sys.stderr,
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        force=True,
    )
    # Docling, torch and friends are chatty at INFO.
    for noisy in ("docling", "docling_ibm_models", "httpx", "urllib3", "PIL", "huggingface_hub"):
        logging.getLogger(noisy).setLevel(logging.WARNING)


def set_progress_sink(sink: Callable[[str, float | None], None] | None) -> None:
    global _progress_sink
    _progress_sink = sink


def progress(message: str, fraction: float | None = None) -> None:
    """Report progress: always to stderr, and as a JSON-RPC notification when a sink is set."""
    with _lock:
        print(f"[progress] {message}", file=sys.stderr, flush=True)
        if _progress_sink is not None:
            _progress_sink(message, fraction)
