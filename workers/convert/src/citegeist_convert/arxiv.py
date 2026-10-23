"""arXiv HTML (LaTeXML) to blocks, with page mapping through the arXiv PDF.

The HTML gives clean structure and LaTeX for every formula (the `alttext` of each `<math>`). It has no pages.
When the PDF of the same paper is available, pages come from two sources: the named destinations that
hyperref writes into the PDF (`section.3`, `equation.2.1`, `figure.4`, ...) anchor headings, equations and
floats; the text of the remaining blocks is searched in the page texts between the surrounding anchors.
"""

from __future__ import annotations

import copy
import re
import unicodedata
from pathlib import Path
from typing import Any

import pypdf
from lxml import html as LH

from .errors import ConvertError

SKIP_CLASSES = {
    "ltx_authors",
    "ltx_dates",
    "ltx_page_footer",
    "ltx_page_logo",
    "ltx_pagination",
    "ltx_rdf",
    "ltx_role_thanks",
    "ltx_classification",
    "ltx_keywords",
}
LEVEL = {
    "ltx_title_document": 0,
    "ltx_title_part": 1,
    "ltx_title_chapter": 1,
    "ltx_title_section": 1,
    "ltx_title_appendix": 1,
    "ltx_title_bibliography": 1,
    "ltx_title_subsection": 2,
    "ltx_title_subsubsection": 3,
    "ltx_title_paragraph": 4,
    "ltx_title_subparagraph": 5,
    "ltx_title_abstract": 1,
}
WS = re.compile(r"\s+")
KEEP_HTML = {"a", "em", "i", "b", "strong", "sub", "sup", "span", "code", "br", "table", "thead", "tbody", "tfoot", "tr", "td", "th", "caption"}


def _classes(el) -> set[str]:
    return set((el.get("class") or "").split())


def _math_latex(m) -> str:
    alt = (m.get("alttext") or "").strip()
    alt = re.sub(r"\\displaystyle\s*", "", alt)
    return alt


def _prepare(el):
    """Copy of the element without footnotes, errors, tags that only decorate and with math as $latex$."""
    el = copy.deepcopy(el)
    for bad in el.xpath(
        ".//*[contains(@class,'ltx_note')] | .//*[contains(@class,'ltx_ERROR')] | .//*[contains(@class,'ltx_rdf')] | .//script | .//style"
    ):
        _drop(bad)
    for m in el.xpath(".//math"):
        latex = _math_latex(m)
        new = LH.Element("span")
        new.set("class", "math")
        new.text = f"${latex}$" if latex else ""
        new.tail = m.tail
        m.getparent().replace(m, new)
    return el


def _drop(el) -> None:
    parent = el.getparent()
    if parent is None:
        return
    tail = el.tail or ""
    prev = el.getprevious()
    if prev is not None:
        prev.tail = (prev.tail or "") + tail
    else:
        parent.text = (parent.text or "") + tail
    parent.remove(el)


def text_of(el, keep_newlines: bool = False) -> str:
    c = _prepare(el)
    for tag in c.xpath(".//*[contains(@class,'ltx_tag_item') or contains(@class,'ltx_tag_listingline')]"):
        _drop(tag)
    for br in c.xpath(".//br"):
        br.tail = "\n" + (br.tail or "") if keep_newlines else " " + (br.tail or "")
    raw = "".join(c.itertext())
    raw = raw.replace("\u200b", "").replace("\u00ad", "")
    if keep_newlines:
        return "\n".join(WS.sub(" ", line).strip() for line in raw.split("\n")).strip()
    return WS.sub(" ", raw).strip()


def clean_html(el) -> str:
    c = _prepare(el)
    for e in c.iter():
        if not isinstance(e.tag, str):
            continue
        keep = {k: v for k, v in e.attrib.items() if k in ("href", "colspan", "rowspan")}
        e.attrib.clear()
        e.attrib.update(keep)
    for e in list(c.iter()):
        if isinstance(e.tag, str) and e.tag not in KEEP_HTML:
            e.drop_tag()
    out = LH.tostring(c, encoding="unicode", with_tail=False)
    return WS.sub(" ", out).strip()


def _tag_text(el) -> str:
    t = el.xpath(".//*[contains(@class,'ltx_tag')]")
    return WS.sub(" ", "".join(t[0].itertext())).strip() if t else ""


def _footnotes(el) -> list[str]:
    out = []
    for n in el.xpath(".//*[contains(@class,'ltx_note_content')]"):
        c = copy.deepcopy(n)
        for t in c.xpath(".//*[contains(@class,'ltx_note_mark') or contains(@class,'ltx_note_type')]"):
            _drop(t)
        txt = WS.sub(" ", "".join(c.itertext())).strip()
        if txt:
            out.append(txt)
    return out


class _Walker:
    def __init__(self) -> None:
        self.blocks: list[dict[str, Any]] = []
        self.refs: list[dict[str, Any]] = []
        self.prefix = ""  # theorem title that is glued to the next paragraph

    def add(self, btype: str, text: str, el, *, flow: str = "body", **extra: Any) -> dict[str, Any] | None:
        if not text.strip() and btype not in ("figure",):
            return None
        if btype == "paragraph" and self.prefix:
            text, self.prefix = f"{self.prefix} {text}".strip(), ""
        block: dict[str, Any] = {
            "type": btype,
            "flow": flow,
            "text": text,
            "spans": [{"page": 0, "label": None, "start": 0, "end": len(text)}],
            "src": {"engine": "latexml-html", "native": el.get("id") or ""},
        }
        for k, v in extra.items():
            if v is not None:
                block[k] = v
        self.blocks.append(block)
        return block

    def notes_after(self, el) -> None:
        for fn in _footnotes(el):
            self.add("footnote", fn, el, flow="notes")

    def walk(self, el) -> None:
        if not isinstance(el.tag, str):
            return
        cl = _classes(el)
        if cl & SKIP_CLASSES or el.tag in ("script", "style", "nav", "header", "footer"):
            return
        tag = el.tag
        if tag == "h1" and "ltx_title_document" in cl:
            self.add("title", text_of(el), el, _level=0)
        elif tag in ("h1", "h2", "h3", "h4", "h5", "h6") and any(c.startswith("ltx_title") for c in cl):
            level = next((LEVEL[c] for c in cl if c in LEVEL), max(1, int(tag[1]) - 1))
            if "ltx_title_theorem" in cl:
                return  # handled with the theorem body
            num = _tag_text(el)
            self.add("heading", text_of(el), el, _level=level, _num=num)
        elif "ltx_abstract" in cl:
            for ch in el:
                self.walk(ch)
        elif tag == "p" and "ltx_p" in cl:
            self.add("paragraph", text_of(el), el)
            self.notes_after(el)
        elif "ltx_biblist" in cl:
            for li in el.xpath("./li"):
                self.bibitem(li)
        elif tag in ("ul", "ol") or cl & {"ltx_itemize", "ltx_enumerate", "ltx_description"}:
            self.list_(el)
        elif tag == "table" and cl & {"ltx_equation", "ltx_equationgroup", "ltx_eqn_table"}:
            self.equation(el)
        elif tag == "figure" or "ltx_float" in cl:
            self.figure(el)
        elif "ltx_listing" in cl:
            self.listing(el)
        elif "ltx_theorem" in cl or "ltx_proof" in cl:
            self.theorem(el)
        elif tag == "section" and "ltx_bibliography" in cl:
            for ch in el:
                self.walk(ch)
        elif tag == "li" and "ltx_bibitem" in cl:
            self.bibitem(el)
        elif tag == "blockquote" or "ltx_quote" in cl:
            self.add("quote", text_of(el), el)
        elif tag == "table" and "ltx_tabular" in cl:
            self.table(el)
        else:
            for ch in el:
                self.walk(ch)

    def list_(self, el) -> None:
        for li in el.xpath("./li"):
            parts = []
            nested = []
            for ch in li:
                if not isinstance(ch.tag, str):
                    continue
                if ch.tag in ("ul", "ol"):
                    nested.append(ch)
                elif "ltx_tag" in _classes(ch):
                    continue
                else:
                    t = text_of(ch)
                    if t:
                        parts.append(t)
                    for p in ch.xpath(".//ul|.//ol"):
                        if p not in nested:
                            nested.append(p)
            txt = WS.sub(" ", " ".join(parts)).strip() or text_of(li)
            tag = _tag_text(li)
            self.add("list-item", txt, li, _marker=tag if re.fullmatch(r"\d+[.)]?", tag.strip()) else None)
            self.notes_after(li)
            for n in nested:
                self.list_(n)

    def equation(self, el) -> None:
        rows = el.xpath(".//tr[contains(@class,'ltx_equation')]") or [el]
        lines = []
        for r in rows:
            latex = " ".join(_math_latex(m) for m in r.xpath(".//math"))
            if latex.strip():
                lines.append(latex.strip())
        latex = " \\\\\n".join(lines)
        tag = ""
        for t in el.xpath(".//*[contains(@class,'ltx_tag_equation')]"):
            tag = WS.sub(" ", "".join(t.itertext())).strip()
            break
        if latex:
            self.add("equation", latex, el, latex=latex, _num=tag)

    def figure(self, el) -> None:
        cl = _classes(el)
        if "ltx_table" in cl:
            for cap in el.xpath("./figcaption"):
                self.add("caption", text_of(cap), cap, _num=_tag_text(cap))
            for t in el.xpath(".//table[contains(@class,'ltx_tabular')]"):
                if not t.xpath("ancestor::table[contains(@class,'ltx_tabular')]"):
                    self.table(t, parent=el)
            return
        if "ltx_float_algorithm" in cl or el.xpath(".//*[contains(@class,'ltx_listing')]"):
            for cap in el.xpath("./figcaption"):
                self.add("caption", text_of(cap), cap, _num=_tag_text(cap))
            for lst in el.xpath(".//*[contains(@class,'ltx_listing')]"):
                self.listing(lst, parent=el)
            return
        subs = el.xpath("./figure | ./div/figure")
        if subs:
            for s in subs:
                self.figure(s)
        else:
            imgs = el.xpath(".//img")
            src = imgs[0].get("src") if imgs else None
            self.add("figure", "", el, _src=src, _num=_tag_text(el.xpath("./figcaption")[0]) if el.xpath("./figcaption") else "")
        for cap in el.xpath("./figcaption"):
            self.add("caption", text_of(cap), cap, _num=_tag_text(cap))

    def table(self, t, parent=None) -> None:
        rows = []
        for tr in t.xpath(".//tr"):
            cells = [text_of(c) for c in tr.xpath("./td|./th")]
            rows.append(" | ".join(cells))
        text = "\n".join(rows)
        md = "\n".join(f"| {r.replace(' | ', ' | ')} |" for r in rows)
        self.add("table", text, parent if parent is not None else t, html=clean_html(t), _md=md, _num=_tag_text(parent) if parent is not None else "")

    def listing(self, el, parent=None) -> None:
        lines = []
        for ln in el.xpath(".//*[contains(@class,'ltx_listingline')]"):
            lines.append(text_of(ln, keep_newlines=True).replace("\n", " "))
        text = "\n".join(lines) if lines else text_of(el, keep_newlines=True)
        self.add("code", text, parent if parent is not None else el, _num=_tag_text(parent) if parent is not None else "")

    def theorem(self, el) -> None:
        head = el.xpath("./h6")
        self.prefix = text_of(head[0]) if head else ""
        for ch in el:
            if ch.tag != "h6":
                self.walk(ch)
        self.prefix = ""

    def bibitem(self, el) -> None:
        blocks = [text_of(b) for b in el.xpath(".//*[contains(@class,'ltx_bibblock')]")]
        tag = _tag_text(el)
        raw = " ".join(b for b in blocks if b)
        text = f"{tag} {raw}".strip() if tag else raw
        doi = None
        for a in el.xpath(".//a/@href"):
            m = re.search(r"10\.\d{4,9}/[^\s\"<>]+", a)
            if m:
                doi = m.group(0).rstrip(".,;)")
                break
        if not doi:
            m = re.search(r"10\.\d{4,9}/[^\s\"<>]+", raw)
            doi = m.group(0).rstrip(".,;)") if m else None
        year = re.search(r"\b(1[5-9]\d\d|20\d\d)\b", raw)
        self.add("reference", text, el)
        self.refs.append(
            {
                "key": el.get("id") or f"r{len(self.refs)}",
                "raw": raw,
                "title": blocks[1].strip("“”\" ") if len(blocks) > 1 else None,
                "venue": None,
                "authors": [a.strip() for a in re.split(r",| and ", blocks[0]) if a.strip()] if blocks else [],
                "year": year.group(1) if year else None,
                "doi": doi,
                "source": "latexml",
            }
        )


def parse(html_path: Path) -> tuple[list[dict[str, Any]], list[dict[str, Any]], str | None]:
    """Blocks, references and the document title of an arXiv HTML file."""
    try:
        root = LH.fromstring(html_path.read_bytes())
    except Exception as e:
        raise ConvertError(
            "HTML_UNREADABLE",
            f"cannot parse {html_path.name}: {e}",
            "Download the HTML again from arxiv.org/html/<id> and retry.",
            recovery="ask-human",
            context={"path": str(html_path)},
        ) from e
    arts = root.xpath("//article")
    if not arts:
        raise ConvertError(
            "NOT_LATEXML",
            f"{html_path.name} has no <article> element, it does not look like arXiv HTML",
            "Use kind=web for general web pages, or fetch the arXiv HTML (arxiv.org/html/<id>) instead.",
            recovery="fix-and-retry",
            context={"path": str(html_path)},
        )
    w = _Walker()
    for ch in arts[0]:
        w.walk(ch)
    title_el = root.xpath("//title")
    return w.blocks, w.refs, (title_el[0].text_content().strip() if title_el else None)


# ------------------------------------------------------------------------------- page mapping


def norm_alnum(s: str) -> str:
    s = unicodedata.normalize("NFKC", s).lower().replace("\u00ad", "")
    return re.sub(r"[\W_]+", "", s)


def _probe(text: str, which: str) -> str:
    """A math-free fragment from the start or end of the text, normalised for search."""
    parts = [p for p in re.split(r"\$[^$]*\$", text) if len(norm_alnum(p)) >= 20]
    if not parts:
        return ""
    frag = norm_alnum(parts[0] if which == "head" else parts[-1])
    return frag[:36] if which == "head" else frag[-36:]


def _dest_pages(reader: pypdf.PdfReader) -> dict[str, int]:
    out: dict[str, int] = {}
    try:
        for name, dest in reader.named_destinations.items():
            try:
                out[str(name)] = reader.get_destination_page_number(dest)
            except Exception:
                continue
    except Exception:
        pass
    return {k: v for k, v in out.items() if v is not None and v >= 0}


def _candidate_dests(block: dict[str, Any]) -> list[str]:
    num = (block.get("_num") or "").strip()
    t = block["type"]
    out: list[str] = []
    if t == "heading":
        n = re.sub(r"[.\s]+$", "", num)
        if not n:
            return out
        for kind in ("section", "subsection", "subsubsection", "appendix", "paragraph", "chapter"):
            out.append(f"{kind}.{n}")
    elif t == "equation":
        n = num.strip("() ")
        out += [f"equation.{n}", f"equation.{re.sub(r'[a-z]$', '', n)}", f"Equation.{n}"]
    elif t in ("figure", "caption", "table", "code"):
        m = re.search(r"(?:Figure|Fig\.|Table|Algorithm)\s*([A-Z]?\.?\d+(?:\.\d+)?)", num)
        if m:
            n = m.group(1)
            kind = "table" if re.search("Table", num) else "algorithm" if "Algorithm" in num else "figure"
            out += [f"{kind}.{n}", f"{kind}.caption.{n}", f"algocf.{n}", f"Item.{n}"]
    return out


def map_pages(
    blocks: list[dict[str, Any]], pdf_path: Path, page_text: list[str]
) -> dict[str, Any]:
    """Assign a page to every block (in place: rewrites spans). Returns statistics."""
    n = len(page_text)
    norm_pages = [norm_alnum(t) for t in page_text]
    reader = pypdf.PdfReader(str(pdf_path))
    dests = _dest_pages(reader)
    anchor: dict[int, int] = {}
    floats = {"figure", "caption", "table", "code"}
    for i, b in enumerate(blocks):
        for name in _candidate_dests(b):
            if name in dests and dests[name] < n:
                anchor[i] = dests[name]
                break
    # in-flow anchors must be monotone; floats keep their own page
    last = 0
    chain: dict[int, int] = {}
    for i in sorted(anchor):
        if blocks[i]["type"] in floats:
            continue
        if anchor[i] >= last:
            chain[i] = anchor[i]
            last = anchor[i]
    stats = {"anchors": len(anchor), "chain": len(chain), "probed": 0, "found": 0, "blocks": len(blocks)}
    pages: list[int] = [0] * len(blocks)
    tail_pages: list[int | None] = [None] * len(blocks)
    chain_idx = sorted(chain)
    cur = 0
    for i, b in enumerate(blocks):
        if i in chain:
            cur = chain[i]
        elif b["type"] in floats and i in anchor:
            pages[i] = anchor[i]
            continue
        nxt = next((chain[j] for j in chain_idx if j > i), n - 1)
        lo, hi = cur, max(cur, nxt)
        if b["type"] in floats:
            pages[i] = cur
            continue
        head = _probe(b["text"], "head")
        page = None
        if head and i not in chain:
            stats["probed"] += 1
            for p in range(lo, hi + 1):
                if head in norm_pages[p]:
                    page = p
                    break
            if page is None:  # allow a small step beyond the next anchor
                for p in range(hi + 1, min(n, hi + 3)):
                    if head in norm_pages[p]:
                        page = p
                        break
            if page is not None:
                stats["found"] += 1
        if page is None:
            page = chain.get(i, cur)
        cur = max(cur, page) if i not in chain else page
        pages[i] = page
        if len(b["text"]) > 300 and b["type"] in ("paragraph", "list-item"):
            tail = _probe(b["text"], "tail")
            if tail:
                for p in range(page, min(n, page + 2)):
                    if tail in norm_pages[p]:
                        tail_pages[i] = p
                        break
    for i, b in enumerate(blocks):
        text = b["text"]
        p0 = pages[i]
        p1 = tail_pages[i]
        if p1 is not None and p1 > p0:
            head = _probe(text, "head")
            pos = norm_pages[p0].find(head) if head else -1
            if pos >= 0:
                rest_norm = len(norm_pages[p0]) - pos
                ratio = len(text) / max(1, len(norm_alnum(text)))
                cut = min(len(text) - 1, int(rest_norm * ratio))
                sp = text.find(" ", cut)
                cut = sp if sp > 0 else cut
                if 0 < cut < len(text):
                    b["spans"] = [
                        {"page": p0, "label": None, "start": 0, "end": cut},
                        {"page": p1, "label": None, "start": cut, "end": len(text)},
                    ]
                    continue
        b["spans"] = [{"page": p0, "label": None, "start": 0, "end": len(text)}]
    return stats
