"""Text quality: the share of word tokens that the system dictionary accepts.

Apple Vision reports confidence 1.0 for every line, so the dictionary hit rate is the signal that
separates good text layers and OCR from noise (S1: scans 0.50 and 0.22, digital PDFs 0.79 to 0.997).
Uses NSSpellChecker on macOS. Elsewhere the score is unavailable (None) and callers treat the text as acceptable.
"""

from __future__ import annotations

import re
import threading
from functools import cache

WORD = re.compile(r"[^\W\d_]{3,}", re.UNICODE)
GATE = 0.6
_lock = threading.Lock()


@cache
def _checker():
    try:
        from AppKit import NSSpellChecker  # type: ignore[import-not-found]

        sc = NSSpellChecker.sharedSpellChecker()
        return sc, NSSpellChecker.uniqueSpellDocumentTag()
    except Exception:
        return None


def available() -> bool:
    return _checker() is not None


def _lang_code(lang: str) -> str:
    return lang.split("-")[0].lower()


def _known(word: str, lang: str) -> bool:
    chk = _checker()
    assert chk is not None
    sc, tag = chk
    r = sc.checkSpellingOfString_startingAt_language_wrap_inSpellDocumentWithTag_wordCount_(
        word, 0, lang, False, tag, None
    )
    return r[0].length == 0


def hit_rate(text: str, languages: list[str] | str) -> tuple[float | None, int]:
    """Best hit rate over the given languages and the number of tokens scored."""
    if isinstance(languages, str):
        languages = [languages]
    words = WORD.findall(text)
    if not words or _checker() is None:
        return None, len(words)
    # Distinct words only: repeated words do not make a page more readable, and it is much faster.
    uniq = list(dict.fromkeys(words))
    codes = list(dict.fromkeys(_lang_code(lang) for lang in languages)) or ["en"]
    with _lock:
        known = {w: any(_known(w, c) for c in codes) for w in uniq}
    # Weight by occurrence so that the score matches the share of running words.
    ok = sum(1 for w in words if known[w])
    return ok / len(words), len(words)
