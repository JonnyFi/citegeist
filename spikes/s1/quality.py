"""Text-quality signal per page: share of German/English word tokens that macOS NSSpellChecker accepts.

Idea: Apple Vision reports confidence 1.0 for everything, so use a dictionary hit rate to flag bad OCR or bad text layers.
usage: uv run python quality.py [id ...] [--ocr]
"""
import json
import re
import sys
from collections import defaultdict

from AppKit import NSSpellChecker

from common import out_dir, select

sc = NSSpellChecker.sharedSpellChecker()
tag = NSSpellChecker.uniqueSpellDocumentTag()
WORD = re.compile(r"[^\W\d_]{3,}", re.UNICODE)


def known(word, lang):
    r = sc.checkSpellingOfString_startingAt_language_wrap_inSpellDocumentWithTag_wordCount_(word, 0, lang, False, tag, None)
    return r[0].length == 0


def hit_rate(text, lang):
    words = WORD.findall(text)
    if not words:
        return None, 0
    ok = sum(1 for w in words if known(w, lang))
    return ok / len(words), len(words)


def main():
    sub = "ocr" if "--ocr" in sys.argv else ""
    for fx in select(sys.argv[1:]):
        p = out_dir(fx) / sub / "blocks.jsonl"
        if not p.exists():
            continue
        lang = "de" if fx["language"] == "de" else "en"
        per_page = defaultdict(list)
        for l in open(p):
            b = json.loads(l)
            if b["flow"] == "body" and b["type"] in ("paragraph", "heading", "list_item", "caption", "footnote", "title"):
                per_page[b["page"]].append(b["text"])
        rates = []
        tot_w = 0
        for pg, texts in sorted(per_page.items()):
            r, n = hit_rate(" ".join(texts), lang)
            if r is not None and n >= 15:
                rates.append((pg, round(r, 3), n))
            tot_w += n
        mean = sum(r for _, r, _ in rates) / len(rates) if rates else None
        low = [pg for pg, r, _ in rates if r < 0.75]
        print(f"{fx['id']:40s} lang={lang} pages_scored={len(rates)} mean_hit_rate={mean if mean is None else round(mean,3)} low_pages(<0.75)={len(low)} words={tot_w}")


if __name__ == "__main__":
    main()
