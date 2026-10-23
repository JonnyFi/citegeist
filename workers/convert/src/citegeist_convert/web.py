"""Web articles and grey literature: trafilatura for the main content, same block model, no pages."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from lxml import etree
from lxml import html as LH

from .errors import ConvertError

WS = re.compile(r"\s+")


def _txt(el) -> str:
    return WS.sub(" ", "".join(el.itertext())).strip()


def _block(btype: str, text: str, native: str, **extra: Any) -> dict[str, Any]:
    b = {
        "type": btype,
        "flow": "body",
        "text": text,
        "spans": [{"page": 0, "label": None, "start": 0, "end": len(text)}],
        "src": {"engine": "trafilatura", "native": native},
    }
    b.update(extra)
    return b


def _from_trafilatura(xml: str) -> list[dict[str, Any]]:
    root = etree.fromstring(xml.encode())
    main = root.find("main")
    if main is None:
        main = root
    blocks: list[dict[str, Any]] = []

    def visit(el) -> None:
        tag = el.tag
        if tag == "head":
            rend = el.get("rend", "h2")
            level = int(rend[1]) - 1 if re.fullmatch(r"h[1-6]", rend) else 1
            t = _txt(el)
            if t:
                blocks.append(_block("heading", t, "head", _level=max(1, level)))
        elif tag == "p":
            t = _txt(el)
            if t:
                blocks.append(_block("paragraph", t, "p"))
        elif tag == "list":
            for item in el.iter("item"):
                t = _txt(item)
                if t:
                    blocks.append(_block("list-item", t, "item"))
        elif tag == "quote":
            t = _txt(el)
            if t:
                blocks.append(_block("quote", t, "quote"))
        elif tag == "code":
            t = "".join(el.itertext()).strip("\n")
            if t.strip():
                blocks.append(_block("code", t, "code"))
        elif tag == "table":
            rows = []
            for r in el.iter("row"):
                rows.append(" | ".join(_txt(c) for c in r.iter("cell")))
            t = "\n".join(rows)
            if t.strip():
                blocks.append(_block("table", t, "table", _md="\n".join(f"| {r} |" for r in rows)))
        else:
            for ch in el:
                visit(ch)

    for ch in main:
        visit(ch)
    return blocks


def _fallback(raw: bytes) -> list[dict[str, Any]]:
    root = LH.fromstring(raw)
    for bad in root.xpath("//script|//style|//nav|//header|//footer|//aside|//form"):
        bad.getparent().remove(bad)
    scope = (root.xpath("//article") or root.xpath("//main") or root.xpath("//body") or [root])[0]
    blocks = []
    for el in scope.iter("h1", "h2", "h3", "h4", "h5", "h6", "p", "li", "blockquote", "pre"):
        t = _txt(el) if el.tag != "pre" else "".join(el.itertext()).strip("\n")
        if not t.strip():
            continue
        if el.tag.startswith("h"):
            blocks.append(_block("heading", t, el.tag, _level=int(el.tag[1])))
        elif el.tag == "li":
            blocks.append(_block("list-item", t, "li"))
        elif el.tag == "blockquote":
            blocks.append(_block("quote", t, "blockquote"))
        elif el.tag == "pre":
            blocks.append(_block("code", t, "pre"))
        else:
            blocks.append(_block("paragraph", t, "p"))
    return blocks


def parse(path: Path) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Blocks and metadata (title, author, date, url, language) of a saved web page."""
    import trafilatura

    raw = path.read_bytes()
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        text = raw.decode("latin-1")
    xml = trafilatura.extract(
        text,
        output_format="xml",
        include_tables=True,
        include_comments=False,
        include_links=False,
        include_formatting=False,
        favor_recall=True,
    )
    blocks = _from_trafilatura(xml) if xml else []
    engine = "trafilatura"
    if len(blocks) < 2:
        blocks = _fallback(raw)
        engine = "lxml-fallback"
        for b in blocks:
            b["src"]["engine"] = engine
    if not blocks:
        raise ConvertError(
            "WEB_NO_CONTENT",
            f"no article text found in {path.name}",
            "Check that the saved page contains the article (not a login or consent wall) and retry.",
            recovery="ask-human",
            context={"path": str(path)},
        )
    meta: dict[str, Any] = {}
    try:
        m = trafilatura.extract_metadata(text)
        if m is not None:
            meta = {
                "title": m.title,
                "authors": [a.strip() for a in (m.author or "").split(";") if a.strip()],
                "date": m.date,
                "url": m.url,
                "sitename": m.sitename,
                "language": m.language,
            }
    except Exception:
        meta = {}
    meta["engine"] = engine
    return blocks, meta
