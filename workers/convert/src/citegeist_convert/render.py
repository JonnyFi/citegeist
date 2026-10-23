"""doc.md and doc.html from the block list.

doc.md follows docs/spec/library-format.md: `<!-- page <index> label=<label> -->` on its own line whenever the
page changes, `<!-- p:<label> -->` inside a paragraph that runs across a page break, and every block ends with
` ^<blockid>`. Blocks that span several lines (tables, code, display equations) put the id on its own line after
a blank line, which is what Obsidian needs for block links. Pages without a printed label use `<!-- page <index> -->`
and `<!-- p:#<index> -->`.

doc.html carries the block id as element id, `data-page` and `data-label` on every block, and a
`<span class="page-break">` inside blocks that span pages.
"""

from __future__ import annotations

import html
import re
from typing import Any

WS = re.compile(r"\s+")


def _one_line(s: str) -> str:
    return WS.sub(" ", s).strip()


def _label_of(pages: list[dict[str, Any]], idx: int) -> str | None:
    return pages[idx]["label"] if 0 <= idx < len(pages) else None


def _page_marker(idx: int, label: str | None) -> str:
    return f"<!-- page {idx} label={label} -->" if label else f"<!-- page {idx} -->"


def _inline_marker(idx: int, label: str | None) -> str:
    return f"<!-- p:{label} -->" if label else f"<!-- p:#{idx} -->"


def _breaks(block: dict[str, Any]) -> list[tuple[int, int]]:
    """(offset, page) of every page change inside the block text, excluding the first span."""
    out = []
    prev = block["spans"][0]["page"] if block["spans"] else 0
    for sp in block["spans"][1:]:
        if sp["page"] != prev and sp["start"] < sp["end"]:
            out.append((sp["start"], sp["page"]))
        prev = sp["page"]
    return out


def _md_text(block: dict[str, Any], pages: list[dict[str, Any]]) -> str:
    text = block["text"]
    cuts = _breaks(block)
    if not cuts:
        return _one_line(text)
    parts, pos = [], 0
    for off, page in cuts:
        parts.append(_one_line(text[pos:off]))
        parts.append(_inline_marker(page, _label_of(pages, page)))
        pos = off
    parts.append(_one_line(text[pos:]))
    return " ".join(p for p in parts if p)


def _fence(text: str) -> str:
    return "```" if "```" not in text else "~~~~"


def block_md(block: dict[str, Any], pages: list[dict[str, Any]], asset: str | None) -> str:
    t, bid = block["type"], block["id"]
    text = _md_text(block, pages)
    if t == "title":
        return f"# {text} ^{bid}"
    if t == "heading":
        level = min(6, max(2, int(block.get("_level", 1)) + 1))
        return f"{'#' * level} {text} ^{bid}"
    if t == "list-item":
        marker = (block.get("_marker") or "").strip()
        bullet = marker if re.fullmatch(r"\d+[.)]", marker) else "-"
        return f"{bullet} {text} ^{bid}"
    if t == "table":
        body = (block.get("_md") or block["text"]).strip()
        return f"{body}\n\n^{bid}" if body else f"*[table]* ^{bid}"
    if t == "figure":
        return f"![figure]({asset}) ^{bid}" if asset else f"*[figure]* ^{bid}"
    if t == "caption":
        return f"*{text}* ^{bid}" if text else f"^{bid}"
    if t == "equation":
        if block.get("latex"):
            return f"$$\n{block['latex'].strip()}\n$$\n\n^{bid}"
        return f"{text} ^{bid}" if text else f"*[formula]* ^{bid}"
    if t == "code":
        body = block["text"].rstrip("\n")
        f = _fence(body)
        lang = block.get("_lang") or ""
        return f"{f}{lang}\n{body}\n{f}\n\n^{bid}"
    if t == "quote":
        return f"> {text} ^{bid}"
    if t == "footnote":
        return f"[fn] {text} ^{bid}"
    return f"{text} ^{bid}"


def render_md(blocks: list[dict[str, Any]], pages: list[dict[str, Any]], assets: dict[str, str]) -> str:
    out: list[str] = []
    current = -1
    for b in blocks:
        if b["flow"] == "furniture":
            continue
        page = b["spans"][0]["page"] if b["spans"] else 0
        if page != current:
            out.append(_page_marker(page, _label_of(pages, page)))
            current = page
        out.append(block_md(b, pages, assets.get(b["id"])))
    return "\n\n".join(out) + "\n"


# ------------------------------------------------------------------------------------------ html


def _attrs(block: dict[str, Any], pages: list[dict[str, Any]]) -> str:
    page = block["spans"][0]["page"] if block["spans"] else 0
    label = _label_of(pages, page)
    a = f'id="{block["id"]}" data-type="{block["type"]}" data-page="{page}"'
    if label:
        a += f' data-label="{html.escape(label, quote=True)}"'
    return a


def _html_text(block: dict[str, Any], pages: list[dict[str, Any]]) -> str:
    text = block["text"]
    cuts = _breaks(block)
    parts, pos = [], 0
    for off, page in cuts:
        parts.append(html.escape(text[pos:off]))
        label = _label_of(pages, page)
        lab = f' data-label="{html.escape(label, quote=True)}"' if label else ""
        parts.append(f'<span class="page-break" role="doc-pagebreak" data-page="{page}"{lab}></span>')
        pos = off
    parts.append(html.escape(text[pos:]))
    return "".join(parts)


def block_html(block: dict[str, Any], pages: list[dict[str, Any]], asset: str | None) -> str:
    t = block["type"]
    a = _attrs(block, pages)
    inner = _html_text(block, pages)
    if t == "title":
        return f"<h1 {a}>{inner}</h1>"
    if t == "heading":
        level = min(6, max(2, int(block.get("_level", 1)) + 1))
        return f"<h{level} {a}>{inner}</h{level}>"
    if t == "list-item":
        return f"<li {a}>{inner}</li>"
    if t == "table":
        body = block.get("html") or f"<pre>{html.escape(block['text'])}</pre>"
        return f'<div {a} class="table">{body}</div>'
    if t == "figure":
        img = f'<img src="{html.escape(asset, quote=True)}" alt="">' if asset else ""
        return f'<figure {a}>{img}</figure>'
    if t == "caption":
        return f"<p {a} class=\"caption\">{inner}</p>"
    if t == "equation":
        latex = block.get("latex")
        data = f' data-latex="{html.escape(latex, quote=True)}"' if latex else ""
        return f'<div {a} class="equation"{data}>{inner}</div>'
    if t == "code":
        return f"<pre {a}><code>{html.escape(block['text'])}</code></pre>"
    if t == "quote":
        return f"<blockquote {a}>{inner}</blockquote>"
    if t == "footnote":
        return f'<aside {a} class="footnote">{inner}</aside>'
    return f"<p {a}>{inner}</p>"


def render_html(
    blocks: list[dict[str, Any]],
    pages: list[dict[str, Any]],
    assets: dict[str, str],
    title: str,
    lang: str,
    source: str,
) -> str:
    body: list[str] = []
    current = -1
    in_list = False
    for b in blocks:
        if b["flow"] == "furniture":
            continue
        page = b["spans"][0]["page"] if b["spans"] else 0
        is_li = b["type"] == "list-item"
        if in_list and not is_li:
            body.append("</ul>")
            in_list = False
        if page != current:
            label = _label_of(pages, page)
            lab = f' data-label="{html.escape(label, quote=True)}"' if label else ""
            body.append(f'<div class="page-break" role="doc-pagebreak" data-page="{page}"{lab}></div>')
            current = page
        if is_li and not in_list:
            body.append("<ul>")
            in_list = True
        body.append(block_html(b, pages, assets.get(b["id"])))
    if in_list:
        body.append("</ul>")
    inner = "\n".join(body)
    return (
        "<!doctype html>\n"
        f'<html lang="{html.escape(lang, quote=True)}">\n<head>\n<meta charset="utf-8">\n'
        f"<title>{html.escape(title)}</title>\n"
        '<meta name="generator" content="citegeist-convert">\n</head>\n'
        f'<body>\n<article data-source="{source}">\n{inner}\n</article>\n</body>\n</html>\n'
    )
