#!/usr/bin/env python3
"""Turn a text written in Word (a .docx file, or text pasted from Word) into a LaTeX project in a
journal template: main.tex, references.bib, the figures, latex.zip for Overleaf.

    python3 word_latex.py paper.docx --template ieee-conference [--bib zotero.bib] [--out folder]
    python3 word_latex.py pasted.html --template ieee-journal --bib zotero.bib

Citations
- Zotero (and Mendeley) store each citation in the .docx as a field with the full item data
  (CSL JSON). Those fields become \\cite{key}; references.bib is built from the same data, so a
  .docx with Zotero citations needs no .bib file. The Zotero bibliography field is dropped: the
  template prints its own reference list.
- Pasted text has no fields, only what Word displays: [1] or (Müller et al., 2023). Those are
  matched against a .bib (a Zotero export) and against the reference list at the end of the text:
  an entry that names a DOI is looked up at doi.org (Crossref/DataCite). Only a match that is
  unique becomes \\cite; everything else stays as written and is listed in the report.
- If a .bib is given, its entries and keys are used for every source it contains (matched by DOI,
  else by title), so keys from Better BibTeX stay the same.

Nothing is reworded: the text goes through pandoc, the citations through this script. The report
(report.json, printed at the end) lists what could not be converted.

Needs pandoc (macOS: brew install pandoc; Linux: sudo apt install pandoc).
"""

import argparse
import html
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unicodedata
import urllib.parse
import xml.etree.ElementTree as ET
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from latex_export import UNICODE_TEX  # noqa: E402

PH = "ZQCITE{}QZ"  # placeholder for a citation; letters only, so pandoc passes it through unchanged
PH_RE = re.compile(r"ZQCITE(\d+)QZ")
BIBL_PH = "ZQBIBLQZ"

# --- templates ---------------------------------------------------------------------------------
# Each template: document class, how citations are written, where the bibliography goes, and the
# widest a figure may be. IEEEtran ships with TeX Live and Overleaf.
IEEE_PREAMBLE = r"""\documentclass[<<OPT>>]{IEEEtran}
% Built by Research Pipeline from a Word text (scripts/word_latex.py); IEEE template: IEEEtran.
\IEEEoverridecommandlockouts
\usepackage[T1]{fontenc}
\usepackage[utf8]{inputenc}
\usepackage{cite}
\usepackage{amsmath,amssymb,amsfonts}
\usepackage{graphicx}
\usepackage{textcomp}
\usepackage{xcolor}
<<COMMON>>
\begin{document}

\title{<<TITLE>>}

<<AUTHOR>>

\maketitle

<<ABSTRACT>>
"""
ARTICLE_PREAMBLE = r"""\documentclass[11pt,a4paper]{article}
% Built by Research Pipeline from a Word text (scripts/word_latex.py).
% Citations: biblatex with style=<<STYLE>>; change it below if the journal asks for another.
\usepackage[T1]{fontenc}
\usepackage[utf8]{inputenc}
\usepackage{lmodern}
\usepackage{microtype}
\usepackage[<<LANG>>]{babel}
\usepackage{csquotes}
\usepackage[margin=2.5cm]{geometry}
\usepackage{amsmath,amssymb}
\usepackage{graphicx}
\usepackage[backend=biber,style=<<STYLE>>]{biblatex}
\addbibresource{references.bib}
<<COMMON>>
\title{<<TITLE>>}
<<AUTHOR>>
\date{}

\begin{document}
\maketitle

<<ABSTRACT>>
"""
# what pandoc's LaTeX output uses: tables, underline/strike-out, links, its two helper macros
COMMON = r"""\usepackage{longtable,booktabs,array,calc,multirow}
\usepackage{soul}
\usepackage[hidelinks]{hyperref}
\providecommand{\tightlist}{\setlength{\itemsep}{0pt}\setlength{\parskip}{0pt}}
\makeatletter
\newsavebox\pandoc@box
\providecommand*\pandocbounded[1]{% scale an image down to the line width and text height
  \sbox\pandoc@box{#1}%
  \Gscale@div\@tempa{\textheight}{\dimexpr\ht\pandoc@box+\dp\pandoc@box\relax}%
  \Gscale@div\@tempb{\linewidth}{\wd\pandoc@box}%
  \ifdim\@tempb\p@<\@tempa\p@\let\@tempa\@tempb\fi
  \ifdim\@tempa\p@<\p@\scalebox{\@tempa}{\usebox\pandoc@box}\else\usebox{\pandoc@box}\fi}
\makeatother
"""
TEMPLATES = {
    "ieee-conference": {"label": "IEEE Konferenz (IEEEtran, conference)", "preamble": IEEE_PREAMBLE,
                        "option": "conference", "cite": "ieee", "maxwidth_in": 3.5},
    "ieee-journal": {"label": "IEEE Journal/Transactions (IEEEtran, journal)", "preamble": IEEE_PREAMBLE,
                     "option": "journal", "cite": "ieee", "maxwidth_in": 3.5},
    "article": {"label": "Allgemeiner Artikel (article, biblatex)", "preamble": ARTICLE_PREAMBLE,
                "option": "", "cite": "biblatex", "maxwidth_in": 6.2},
}
BIBLATEX_STYLES = ("apa", "authoryear", "numeric", "ieee", "chicago-authordate")

REF_HEADINGS = re.compile(r"^(references|reference list|bibliography|works cited|literatur|literaturverzeichnis|"
                          r"quellen|quellenverzeichnis|referenzen)$", re.I)
ABSTRACT_WORDS = r"(?:abstract|zusammenfassung|kurzfassung)"
KEYWORD_WORDS = r"(?:index terms|keywords?|key words|schlüsselwörter|schlagwörter|stichwörter|schlüsselbegriffe)"
DASH = r"(?:\u2014|–|:|\.|-{1,3})"


class ConvertError(Exception):
    pass


# --- small helpers -----------------------------------------------------------------------------

ACCENTS = {'"': "\u0308", "'": "\u0301", "`": "\u0300", "^": "\u0302", "~": "\u0303", "=": "\u0304", ".": "\u0307",
           "u": "\u0306", "v": "\u030c", "H": "\u030b", "c": "\u0327", "k": "\u0328", "r": "\u030a"}
LETTERS = {"ss": "ß", "o": "ø", "O": "Ø", "ae": "æ", "AE": "Æ", "aa": "å", "AA": "Å", "l": "ł", "L": "Ł", "i": "ı"}


def detex(s):
    """BibTeX text (Zotero's own export writes {\\"u}) as plain Unicode, braces removed."""
    s = re.sub(r"\\([\"'`^~=.]|[uvHckr](?=[\s{]))\s*\{?\\?([A-Za-z])\}?", lambda m: m.group(2) + ACCENTS[m.group(1)], s)
    s = re.sub(r"\\(ss|ae|AE|aa|AA|[oOlLi])(?![A-Za-z])\s*", lambda m: LETTERS[m.group(1)], s)
    s = re.sub(r"\\[A-Za-z]+\s*", "", s).replace("\\&", "&").replace("~", " ")
    return unicodedata.normalize("NFC", s.replace("{", "").replace("}", "")).strip()


def fold(s):
    """Lower-case ASCII letters and digits only: 'Müller-Lüdenscheidt' -> 'mullerludenscheidt'."""
    s = unicodedata.normalize("NFKD", detex(s or ""))
    return re.sub(r"[^a-z0-9]", "", "".join(c for c in s if not unicodedata.combining(c)).lower())


def norm_doi(doi):
    doi = (doi or "").strip().lower()
    doi = re.sub(r"^(https?://(dx\.)?doi\.org/|doi:\s*)", "", doi)
    return doi.rstrip(".,;)")


def tex_escape(s):
    s = str(s).replace("\\", r"\textbackslash{}")
    s = re.sub(r"([&%#_$])", r"\\\1", s)
    return s.replace("{", r"\{").replace("}", r"\}").replace(r"\textbackslash\{\}", r"\textbackslash{}") \
            .replace("^", r"\^{}").replace("~", r"\~{}")


def pandoc_exe():
    exe = shutil.which("pandoc")
    if not exe:
        raise ConvertError("pandoc fehlt. macOS: brew install pandoc · Linux: sudo apt install pandoc")
    return exe


def run_pandoc(args, stdin=None, cwd=None):
    res = subprocess.run([pandoc_exe(), *args], input=stdin, capture_output=True, text=True, encoding="utf-8", cwd=cwd)
    if res.returncode != 0:
        raise ConvertError(f"pandoc: {res.stderr.strip()[:400]}")
    return res.stdout


def md_to_latex(markdown, shift=0):
    if not markdown.strip():
        return ""
    args = ["-f", "markdown", "-t", "latex", "--wrap=preserve"]
    if shift:
        args.append(f"--shift-heading-level-by={shift}")
    return run_pandoc(args, markdown).strip()


# --- BibTeX: read a .bib, write entries from CSL JSON -------------------------------------------

def parse_bib(text):
    """[{type, key, fields: {name: raw value}, raw}] for every entry; @comment, @string, @preamble skipped."""
    out = []
    for m in re.finditer(r"@(\w+)\s*([{(])", text):
        etype = m.group(1).lower()
        if etype in ("comment", "string", "preamble"):
            continue
        depth, i = 1, m.end()
        while i < len(text) and depth:
            depth += {"{": 1, "(": 1 if m.group(2) == "(" else 0, "}": -1, ")": -1 if m.group(2) == "(" else 0}.get(text[i], 0)
            i += 1
        body = text[m.end():i - 1]
        key, _, rest = body.partition(",")
        fields, j = {}, 0
        while True:
            f = re.compile(r"\s*([\w-]+)\s*=\s*").match(rest, j)
            if not f:
                break
            j = f.end()
            if j < len(rest) and rest[j] in "{\"":
                close, depth, k = "}" if rest[j] == "{" else '"', 0, j
                while k < len(rest):
                    c = rest[k]
                    if c == "{":
                        depth += 1
                    elif c == "}":
                        depth -= 1
                    if (close == "}" and depth == 0 and c == "}") or (close == '"' and c == '"' and k > j and depth == 0):
                        break
                    k += 1
                value, j = rest[j + 1:k], k + 1
            else:
                v = re.compile(r"[^,]*").match(rest, j)
                value, j = v.group(0).strip(), v.end()
            fields[f.group(1).lower()] = value
            c = re.compile(r"\s*,").match(rest, j)
            if not c:
                break
            j = c.end()
        out.append({"type": etype, "key": key.strip(), "fields": fields, "raw": text[m.start():i]})
    return out


def split_authors(value):
    """BibTeX author field -> [(family, given)] ; 'and' inside braces does not split."""
    parts, depth, cur = [], 0, ""
    tokens = re.split(r"(\{|\}|\s+and\s+)", value or "")
    for t in tokens:
        if t == "{":
            depth += 1
        elif t == "}":
            depth -= 1
        if depth == 0 and re.fullmatch(r"\s+and\s+", t or ""):
            parts.append(cur)
            cur = ""
        else:
            cur += t or ""
    parts.append(cur)
    out = []
    for p in (p.strip() for p in parts if p.strip()):
        if p.startswith("{") and p.endswith("}") and "," not in p:
            out.append((detex(p), ""))
        elif "," in p:
            fam, _, giv = p.partition(",")
            out.append((detex(fam), detex(giv)))
        else:
            words = detex(p).split()
            out.append((words[-1] if words else "", " ".join(words[:-1])))
    return out


def bib_record(entry):
    """What citation matching needs from a parsed .bib entry."""
    f = entry["fields"]
    year = re.search(r"\d{4}", f.get("year") or f.get("date") or "")
    return {"key": entry["key"], "bibtex": entry["raw"].strip(), "doi": norm_doi(detex(f.get("doi", ""))),
            "title": detex(f.get("title", "")), "year": year.group(0) if year else "",
            "families": [a for a, _ in split_authors(f.get("author") or f.get("editor") or "")]}


CSL_TYPES = {"article-journal": ("article", "journal"), "article-magazine": ("article", "journal"),
             "article-newspaper": ("article", "journal"), "paper-conference": ("inproceedings", "booktitle"),
             "chapter": ("incollection", "booktitle"), "entry-encyclopedia": ("incollection", "booktitle"),
             "book": ("book", None), "report": ("techreport", None), "thesis": ("phdthesis", None),
             "dataset": ("misc", None), "webpage": ("misc", None), "post-weblog": ("misc", None),
             "article": ("misc", None), "manuscript": ("unpublished", None), "software": ("misc", None),
             # Crossref's own type names, which doi.org sometimes returns in CSL JSON
             "journal-article": ("article", "journal"), "proceedings-article": ("inproceedings", "booktitle"),
             "book-chapter": ("incollection", "booktitle"), "posted-content": ("misc", None),
             "dissertation": ("phdthesis", None), "monograph": ("book", None), "edited-book": ("book", None)}


def csl_year(item):
    parts = (item.get("issued") or {}).get("date-parts") or [[]]
    if parts and parts[0] and parts[0][0]:
        return str(parts[0][0])
    m = re.search(r"\d{4}", str((item.get("issued") or {}).get("raw") or (item.get("issued") or {}).get("literal") or ""))
    return m.group(0) if m else ""


def csl_names(names):
    out = []
    for n in names or []:
        if n.get("literal"):
            out.append("{" + tex_escape(n["literal"]) + "}")
        elif n.get("family"):
            fam = " ".join(filter(None, [n.get("non-dropping-particle"), n["family"]]))
            fam = tex_escape(fam)
            if " " in fam:
                fam = "{" + fam + "}"
            out.append(f"{fam}, {tex_escape(n['given'])}" if n.get("given") else fam)
    return " and ".join(out)


def csl_key(item, used):
    names = item.get("author") or item.get("editor") or []
    first = names[0] if names else {}
    fam = fold(first.get("family") or first.get("literal") or "") or "anon"
    word = next((w for w in re.findall(r"[^\W\d_]{4,}", item.get("title") or "")
                 if w.lower() not in {"with", "from", "that", "this", "their", "towards", "toward", "über", "eine", "einer"}), "")
    base = f"{fam[:20]}{csl_year(item) or 'nd'}{fold(word)[:16]}"
    key, n = base, 0
    while key in used:
        n += 1
        key = base + "abcdefghijklmnopqrstuvwxyz"[(n - 1) % 26] * ((n - 1) // 26 + 1)
    used.add(key)
    return key


def csl_to_bibtex(item, key):
    etype, container = CSL_TYPES.get(item.get("type"), ("misc", None))
    if item.get("type") == "article" and item.get("container-title"):
        etype, container = "article", "journal"
    title = item.get("title") or ""
    fields = [("author", csl_names(item.get("author"))), ("editor", csl_names(item.get("editor")) if etype in ("book", "incollection", "inproceedings") else ""),
              ("title", tex_escape(title)),
              (container or "", tex_escape(item.get("container-title") or "") if container else ""),
              ("year", csl_year(item)), ("volume", item.get("volume") or ""),
              ("number", item.get("issue") or item.get("number") or ""),
              ("pages", re.sub(r"\s*[-–]\s*", "--", str(item.get("page") or ""))),
              ("publisher" if etype not in ("techreport", "phdthesis") else ("institution" if etype == "techreport" else "school"),
               tex_escape(item.get("publisher") or "")),
              ("address", tex_escape(item.get("publisher-place") or "")),
              ("edition", str(item.get("edition") or "")), ("isbn", item.get("ISBN") or ""),
              ("doi", norm_doi(item.get("DOI") or "")),
              ("url", item.get("URL") or "" if not item.get("DOI") else ""),
              ("note", tex_escape(item.get("genre") or "") if item.get("type") in ("article", "report") else "")]
    if item.get("type") in ("webpage", "post-weblog") and (item.get("container-title")):
        fields.append(("howpublished", tex_escape(item["container-title"])))
    body = ",\n".join(f"  {k} = {{{v}}}" for k, v in fields if k and v)
    return f"@{etype}{{{key},\n{body}\n}}"


def csl_record(item, used):
    key = csl_key(item, used)
    return {"key": key, "bibtex": csl_to_bibtex(item, key), "doi": norm_doi(item.get("DOI") or ""),
            "title": item.get("title") or "", "year": csl_year(item),
            "families": [n.get("family") or n.get("literal") or "" for n in item.get("author") or item.get("editor") or []]}


# --- sources: the user's .bib, plus records built along the way ------------------------------------

class Library:
    def __init__(self, bib_text=""):
        self.bib = [bib_record(e) for e in parse_bib(bib_text or "")]
        self.used = {r["key"] for r in self.bib}
        self.cited = {}  # key -> record, in order of first citation
        self.by_item = {}  # Zotero item URI / CSL id -> record

    def find(self, doi="", title=""):
        doi, t = norm_doi(doi), fold(title)
        for r in self.bib:
            if (doi and r["doi"] == doi) or (t and len(t) > 12 and fold(r["title"]) == t):
                return r
        return None

    def from_csl(self, citation_item):
        """Record for one Zotero citation item; the user's .bib entry if it holds the same source."""
        data = citation_item.get("itemData") or {}
        uri = ((citation_item.get("uris") or [citation_item.get("uri")]) or [None])[0] or str(citation_item.get("id"))
        if uri in self.by_item:
            return self.by_item[uri]
        rec = self.find(data.get("DOI"), data.get("title")) or csl_record(data, self.used)
        self.by_item[uri] = rec
        return rec

    def cite(self, rec):
        self.cited.setdefault(rec["key"], rec)
        return rec["key"]


# --- .docx: Zotero/Mendeley fields -> placeholders --------------------------------------------------

TOKEN = re.compile(r'<w:fldChar\b[^>]*?w:fldCharType="(begin|separate|end)"[^>]*>|<w:instrText\b[^>]*>(.*?)</w:instrText>'
                   r'|<w:fldSimple\b[^>]*?w:instr="([^"]*)"[^>]*?(?:/>|>(.*?)</w:fldSimple>)', re.S)
RUN_START = re.compile(r"<w:r(?=[\s>])")


def classify(instr):
    """('cite', CSL citation dict) | ('bibl', None) | (None, None) for a field instruction."""
    instr = html.unescape(instr).strip()
    m = re.match(r"ADDIN\s+(?:ZOTERO_ITEM\s+)?CSL_CITATION\s*", instr)
    if m:
        try:
            return "cite", json.JSONDecoder().raw_decode(instr[m.end():])[0]
        except (json.JSONDecodeError, ValueError):
            return "broken", None
    if re.match(r"ADDIN\s+(ZOTERO_BIBL|Mendeley Bibliography|CSL_BIBLIOGRAPHY)", instr):
        return "bibl", None
    return None, None


def replace_fields(xml, fields):
    """Replace every Zotero/Mendeley field in a WordprocessingML part by a single placeholder run."""
    spans, stack = [], []
    for m in TOKEN.finditer(xml):
        kind, instr, simple = m.group(1), m.group(2), m.group(3)
        if simple is not None:
            what, data = classify(simple)
            if what and not any(s["what"] for s in stack):
                spans.append((m.start(), m.end(), what, data))
        elif kind == "begin":
            run = list(RUN_START.finditer(xml, 0, m.start()))
            stack.append({"start": run[-1].start() if run else m.start(), "instr": [], "what": None, "data": None})
        elif instr is not None and stack:
            stack[-1]["instr"].append(instr)
        elif kind == "separate" and stack:
            stack[-1]["what"], stack[-1]["data"] = classify("".join(stack[-1]["instr"]))
        elif kind == "end" and stack:
            f = stack.pop()
            if f["what"] is None:
                f["what"], f["data"] = classify("".join(f["instr"]))
            if f["what"] and not any(s["what"] for s in stack):
                close = xml.find("</w:r>", m.end())
                spans.append((f["start"], close + len("</w:r>") if close >= 0 else m.end(), f["what"], f["data"]))
    for start, end, what, data in reversed(spans):
        if what == "cite":
            fields.append(data)
            text = PH.format(len(fields) - 1)
        elif what == "bibl":
            text = BIBL_PH
        else:  # unreadable field code: keep what Word displays
            continue
        xml = xml[:start] + f'<w:r><w:t xml:space="preserve">{text}</w:t></w:r>' + xml[end:]
    return xml, len([s for s in spans if s[2] == "broken"])


def prepare_docx(path, tmp):
    """Copy of the .docx with citation fields replaced; returns (path, CSL citations, unreadable fields)."""
    fields, broken = [], 0
    out = os.path.join(tmp, "input.docx")
    try:
        zin = zipfile.ZipFile(path)
    except zipfile.BadZipFile:
        raise ConvertError("Die Datei ist keine .docx (Word 2007 oder neuer). Ältere .doc bitte in Word als .docx speichern.")
    with zin, zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zout:
        for info in zin.infolist():
            data = zin.read(info.filename)
            if info.filename in ("word/document.xml", "word/footnotes.xml", "word/endnotes.xml"):
                xml = data.decode("utf-8")
                new, b = replace_fields(xml, fields)
                try:
                    ET.fromstring(new.encode("utf-8"))
                    data, broken = new.encode("utf-8"), broken + b
                except ET.ParseError:  # a field spanning odd structures: keep the part as Word displays it
                    del fields[len(fields) - new.count("ZQCITE"):]
            zout.writestr(info, data)
    return out, fields, broken


# --- text pasted from Word (clipboard HTML) -----------------------------------------------------------

def clean_word_html(src, notes):
    """Word's clipboard HTML, reduced to what pandoc reads well: title, footnotes, no Office markup."""
    src = re.sub(r"<!--\[if[^\]]*\]>.*?<!\[endif\]-->", "", src, flags=re.S | re.I)
    src = re.sub(r"<!--.*?-->", "", src, flags=re.S)
    src = re.sub(r"</?o:p>|<w:[^>]*>|</w:[^>]*>|<m:[^>]*>|</m:[^>]*>", "", src, flags=re.I)
    if re.search(r"<img\b", src, re.I):
        notes.append("Bilder kommen per Kopieren nicht mit; sie fehlen in main.tex. Für Bilder die .docx hochladen.")
        src = re.sub(r"<img\b[^>]*>", "", src, flags=re.I)
    title = ""
    m = re.search(r"<p\b[^>]*class=\"?MsoTitle\"?[^>]*>(.*?)</p>", src, re.S | re.I)
    if m:
        title = html.unescape(re.sub(r"<[^>]+>", "", m.group(1))).strip()
        src = src[:m.start()] + src[m.end():]
    src = re.sub(r"<p\b[^>]*class=\"?MsoSubtitle\"?[^>]*>.*?</p>", "", src, flags=re.S | re.I)
    # Word footnotes: <a style='mso-footnote-id:ftn1' href="#_ftn1">…</a> and <div style='mso-element:footnote' id=ftn1>
    bodies = {}
    for d in re.finditer(r"<div\b[^>]*mso-element:\s*footnote[^>]*id=\"?(\w+)\"?[^>]*>(.*?)</div>", src, re.S | re.I):
        text = re.sub(r"<a\b[^>]*href=\"?#_ftnref\d+\"?[^>]*>.*?</a>", "", d.group(2), flags=re.S | re.I)
        bodies[d.group(1)] = re.sub(r"</?p\b[^>]*>", " ", text).strip()
    src = re.sub(r"<div\b[^>]*mso-element:\s*footnote(?:-list)?[^>]*>.*?</div>", "", src, flags=re.S | re.I)
    src = re.sub(r"<div\b[^>]*mso-element:\s*footnote-list[^>]*>", "", src, flags=re.I)
    order = []

    def ref(m):
        fid = m.group(1)
        if fid not in bodies:
            return m.group(0)
        order.append(fid)
        n = len(order)
        return f'<a href="#fn{n}" class="footnote-ref" id="fnref{n}" role="doc-noteref"><sup>{n}</sup></a>'
    src = re.sub(r"<a\b[^>]*mso-footnote-id:\s*(\w+)[^>]*>.*?</a>", ref, src, flags=re.S | re.I)
    if order:
        items = "".join(f'<li id="fn{i}"><p>{bodies[f]}</p></li>' for i, f in enumerate(order, 1))
        foot = f'<section class="footnotes" role="doc-endnotes"><ol>{items}</ol></section>'
        src = re.sub(r"</body>", foot + "</body>", src, count=1, flags=re.I) if re.search(r"</body>", src, re.I) else src + foot
    if title:
        head = f"<title>{html.escape(title)}</title>"
        src = re.sub(r"<head\b[^>]*>", lambda h: h.group(0) + head, src, count=1, flags=re.I) if re.search(r"<head\b", src, re.I) \
            else f"<html><head>{head}</head><body>{src}</body></html>"
    return src


def plain_to_html(text, notes):
    """Plain text knows no headings: a short single line without closing punctuation is taken as one."""
    paras = [p.strip() for p in re.split(r"\n\s*\n", text.replace("\r\n", "\n")) if p.strip()]
    out, title, heads = [], "", 0
    for i, p in enumerate(paras):
        if "\n" not in p and len(p) <= 90 and not re.search(r"[.,;:!?)]$", p) and re.match(r"[\w„“\"]", p):
            if i == 0 and len(paras) > 1:
                title = p
                continue
            out.append(f"<h1>{html.escape(p)}</h1>")
            heads += 1
        else:
            out.append(f"<p>{html.escape(p).replace(chr(10), '<br>')}</p>")
    notes.append("Reiner Text ohne Formatierung: Titel und Überschriften wurden an kurzen Zeilen erkannt; bitte prüfen. "
                 "Aus Word kopiert bleibt die Formatierung erhalten.")
    head = f"<head><title>{html.escape(title)}</title></head>" if title else ""
    return f"<html>{head}<body>" + "".join(out) + "</body></html>"


# --- structure: title, authors, abstract, keywords, reference list --------------------------------------

SENTINEL_TEMPLATE = "%%TITLE\n$title$\n%%AUTHOR\n$for(author)$$author$$sep$\n$endfor$\n%%ABSTRACT\n$abstract$\n%%BODY\n$body$\n"
HEADING = re.compile(r"^(#{1,6}) +(.+?)[ \t]*(\{[^}\n]*\})?[ \t]*$", re.M)
NUMBERED = re.compile(r"^((?:\d+(?:\.\d+)*\\?\.?)|(?:[IVXLC]+\\?\.)|(?:[A-Z]\\?\.))\s+(.+)$")


def strip_number(text, level, top):
    m = NUMBERED.match(text)
    if not m:
        return None
    if re.fullmatch(r"[A-HJ-UWYZ]\\?\.", m.group(1)) and level == top:  # "A." numbers subsections; "I." "V." "X." are roman
        return None
    return m.group(2)


def heading_text(md_heading):
    return re.sub(r"[*_`]", "", md_heading).strip()


def split_structure(meta, body, report):
    """Take title, authors, abstract and keywords out of the body; return (parts, body, top heading level)."""
    title, authors, abstract, keywords = meta["title"].strip(), [a.strip() for a in meta["author"].splitlines() if a.strip()], \
        meta["abstract"].strip(), ""
    heads = list(HEADING.finditer(body))
    if not title and heads and not body[:heads[0].start()].strip():
        first = heads[0]
        if not any(len(h.group(1)) <= len(first.group(1)) for h in heads[1:]):
            title, body = first.group(2).strip(), body[first.end():]
    # abstract: a heading "Abstract", a paragraph "Abstract", or "Abstract" + em dash + text (IEEE's Word template)
    if not abstract:
        m = re.search(rf"^#{{1,6}} +[*_]*{ABSTRACT_WORDS}[*_]*[ \t]*(?:\{{[^}}\n]*\}})?[ \t]*\n\n(.*?)(?=^#{{1,6}} |\Z)", body, re.M | re.S | re.I) \
            or re.search(rf"^[*_]*{ABSTRACT_WORDS}[*_]*[ \t]*\n\n(.+?)(?=\n\n|\Z)", body, re.M | re.S | re.I)  # paragraph "Abstract": the next one
        if m and m.start() < len(body) // 2 + 1:
            abstract, body = m.group(1).strip(), body[:m.start()] + body[m.end():]
        else:
            m = re.search(rf"^[*_]*{ABSTRACT_WORDS}[*_]*\s*{DASH}\s*[*_]*\s*(.+?)\s*$", body, re.M | re.I)
            if m and m.start() < len(body) // 2 + 1:
                abstract, body = m.group(1).strip(), body[:m.start()] + body[m.end():]
    for where in ("abstract", "body"):
        text = abstract if where == "abstract" else body
        m = re.search(rf"^[*_]*{KEYWORD_WORDS}[*_]*\s*{DASH}\s*[*_]*\s*(.+?)\s*$", text, re.M | re.I)
        if m:
            keywords = re.sub(r"[*_]+$", "", m.group(1)).strip().rstrip(".")
            text = (text[:m.start()] + text[m.end():]).strip("\n") + "\n"
            if where == "abstract":
                abstract = text.strip()
            else:
                body = text
            break
    # what stands before the first heading and is not abstract: author names and affiliations
    heads = list(HEADING.finditer(body))
    front = body[:heads[0].start()] if heads else ""
    if front.strip() and len(front) < 1500:
        authors = authors or [line.strip() for line in re.split(r"\n\s*\n", front.strip()) if line.strip()]
        body = body[heads[0].start():]
        report["notes"].append("Text vor der ersten Überschrift steht als Autorenangabe im Kopf von main.tex; bitte prüfen.")
    if not title:
        report["notes"].append("Kein Titel erkannt (Word-Formatvorlage „Titel“); bitte in main.tex eintragen.")
    if not abstract:
        report["notes"].append("Kein Abstract erkannt (Überschrift oder Absatz „Abstract“); bitte in main.tex eintragen.")
    return {"title": title, "authors": authors, "abstract": abstract, "keywords": keywords}, body


def take_reference_list(body):
    """Remove the reference-list section; return (body, entries [(number or None, text)], had a Zotero bibliography)."""
    heads = list(HEADING.finditer(body))
    for i, h in enumerate(heads):
        text = heading_text(h.group(2))
        text = NUMBERED.match(text).group(2) if NUMBERED.match(text) else text
        if not REF_HEADINGS.match(text):
            continue
        level = len(h.group(1))
        end = next((n.start() for n in heads[i + 1:] if len(n.group(1)) <= level), len(body))
        section = body[h.end():end]
        body = body[:h.start()] + body[end:]
        entries = []
        for para in re.split(r"\n\s*\n", section.replace(BIBL_PH, "")):
            para = " ".join(para.split())
            if not para:
                continue
            m = re.match(r"^\\?\[(\d+)\\?\]\s*(.+)$", para) or re.match(r"^(\d+)\.\s+(.+)$", para)
            entries.append((int(m.group(1)), m.group(2)) if m else (None, para))
        return body, entries, BIBL_PH in section
    return body.replace(BIBL_PH, ""), [], BIBL_PH in body


def number_headings(body, top):
    """Manual heading numbers ('2.1 Method', 'II. RESULTS') go; LaTeX numbers the sections itself."""
    heads = list(HEADING.finditer(body))
    numbered = [h for h in heads if strip_number(h.group(2), len(h.group(1)), top)]
    if not numbered or len(numbered) < len(heads) / 2:
        return body

    def fix(h):
        rest = strip_number(h.group(2), len(h.group(1)), top)
        attr = h.group(3) or ""
        return f"{h.group(1)} {rest} {attr}".rstrip() if rest else f"{h.group(1)} {h.group(2)} {{-}}"
    return HEADING.sub(fix, body)


# --- citations written as text: [1], (Müller et al., 2023), Müller et al. (2023) -----------------------------

YEAR = r"(?:1[6-9]|20)\d{2}[a-z]?"
LOCATOR = r"(?:pp?\.|S\.|Kap\.|ch\.|chap\.|sec\.|Abschn\.)\s*[\w–-]+(?:\s*[–-]+\s*\w+)?"
NAME = r"[A-ZÄÖÜ\u00C0-\u024F][\w'’\u00C0-\u024F-]+"
NAMES = rf"(?:(?:van|von|de|der|den|di|da|le|la|du)\s+)*{NAME}(?:\s+(?:et al\.|u\.\s?a\.|(?:&|and|und)\s+(?:(?:van|von|de|der|den)\s+)*{NAME}))?"
PAREN = re.compile(r"\(([^()\n]{0,400}?\b" + YEAR + r"\b[^()\n]{0,200}?)\)")
NARRATIVE = re.compile(rf"\b({NAMES})(?:’s|'s)?\s+\(({YEAR}(?:,\s*{YEAR})*)(?:,\s*({LOCATOR}))?\)")
PART = re.compile(rf"^(?P<pre>(?:e\.\s?g\.,?|i\.\s?e\.,?|see(?: also)?|cf\.|vgl\.(?: auch)?|siehe(?: auch)?|z\.\s?B\.)\s+)?"
                  rf"(?P<names>{NAMES}),?\s+(?P<years>{YEAR}(?:,\s*{YEAR})*)(?:,\s*(?P<loc>{LOCATOR}))?$")
NUMERIC = re.compile(r"\\?\[(\d{1,3}(?:\s*(?:,|–|\u2014|-{1,2})\s*\d{1,3})*)(?:,\s*(" + LOCATOR + r"))?\\?\]"
                     r"(?:\s*(?:–|\u2014|-{1,2}|,)\s*\\?\[(\d{1,3}(?:\s*(?:,|–|\u2014|-{1,2})\s*\d{1,3})*)\\?\])*")


def name_families(names):
    names = re.sub(r"\s+(et al\.|u\.\s?a\.)$", "", names)
    return [fold(n) for n in re.split(r"\s+(?:&|and|und)\s+", names)], bool(re.search(r"et al\.|u\.\s?a\.", names))


def match_author_year(pool, names, year):
    fams, etal = name_families(names)
    y, suffix = year[:4], year[4:]
    cands = []
    for r in pool:
        rf = [fold(f) for f in r["families"]]
        if r["year"] != y or not rf:
            continue
        if not (rf[0] == fams[0] or rf[0].endswith(fams[0]) or fams[0].endswith(rf[0])):
            continue
        if len(fams) > 1 and (len(rf) < 2 or rf[1] != fams[1]):
            continue
        if len(fams) == 1 and not etal and len(rf) > 2:
            continue
        cands.append(r)
    if len(cands) > 1 and suffix:
        return None  # 2023a/2023b of the same author: which is which is the citation style's call, not ours
    return cands[0] if len(cands) == 1 else None


def expand_numbers(spec):
    out = []
    for part in re.split(r"\s*,\s*", spec):
        m = re.match(r"(\d+)\s*(?:–|\u2014|-{1,2})\s*(\d+)$", part)
        if m and int(m.group(1)) <= int(m.group(2)) <= int(m.group(1)) + 50:
            out += list(range(int(m.group(1)), int(m.group(2)) + 1))
        elif part.isdigit():
            out.append(int(part))
    return out


class TextCitations:
    """Citations Word only displays as text, turned into placeholders where the source is unique."""

    def __init__(self, lib, numbered, citations, report):
        self.lib, self.numbered, self.citations, self.report = lib, numbered, citations, report
        self.pool = list({r["key"]: r for r in lib.bib + list(numbered.values())}.values())

    def add(self, items, narrative=False):
        self.citations.append({"items": items, "narrative": narrative})
        return PH.format(len(self.citations) - 1)

    def numeric(self, m):
        nums = []
        for spec in re.findall(r"\\?\[([\d\s,–\u2014-]+?)(?:,\s*" + LOCATOR + r")?\\?\]", m.group(0)):
            nums += expand_numbers(spec)
        between = re.findall(r"\\?\](\s*(?:–|\u2014|-{1,2})\s*)\\?\[", m.group(0))
        if between and len(re.findall(r"\\?\[", m.group(0))) == 2:  # [1]–[4]
            ends = [int(x) for x in re.findall(r"\d+", m.group(0))]
            nums = list(range(ends[0], ends[-1] + 1)) if ends[0] <= ends[-1] <= ends[0] + 50 else nums
        if not nums or any(n not in self.numbered for n in nums):
            if nums and self.numbered:
                self.report["unmatched"].append(m.group(0).replace("\\", ""))
            return m.group(0)
        loc = m.group(2) or ""
        items = [{"key": self.lib.cite(self.numbered[n]), "loc": loc if len(nums) == 1 else "", "pre": "", "suf": ""} for n in nums]
        return self.add(items)

    def paren(self, m):
        parts = [p.strip() for p in m.group(1).split(";")]
        items = []
        for p in parts:
            pm = PART.match(p)
            if not pm:
                if items or len(parts) > 1:
                    self.report["unmatched"].append(m.group(0))
                return m.group(0)
            for y in re.split(r",\s*", pm.group("years")):
                rec = match_author_year(self.pool, pm.group("names"), y)
                if not rec:
                    self.report["unmatched"].append(m.group(0))
                    return m.group(0)
                items.append({"key": self.lib.cite(rec), "loc": pm.group("loc") or "", "pre": (pm.group("pre") or "").strip(), "suf": ""})
        return self.add(items)

    def narrative(self, m):
        items = []
        for y in re.split(r",\s*", m.group(2)):
            rec = match_author_year(self.pool, m.group(1), y)
            if not rec:
                return m.group(0)
            items.append({"key": self.lib.cite(rec), "loc": m.group(3) or "", "pre": "", "suf": ""})
        return self.add(items, narrative=m.group(1))

    def apply(self, text):
        if self.numbered:
            text = NUMERIC.sub(self.numeric, text)
        if self.pool:
            text = NARRATIVE.sub(self.narrative, text)
            text = PAREN.sub(self.paren, text)
        return text


def resolve_reference_list(entries, lib, report, lookup):
    """{number: record} for a numbered list; for an author-year list the records join the pool."""
    resolved, unnumbered = {}, []
    for i, (num, text) in enumerate(entries):
        doi = re.search(r"\b(10\.\d{4,9}/[^\s\"<>]+)", text.replace("\\", ""))
        doi = norm_doi(doi.group(1)) if doi else ""
        rec = lib.find(doi=doi) if doi else None
        if not rec:
            t = fold(text)
            rec = next((r for r in lib.bib if len(fold(r["title"])) > 15 and fold(r["title"]) in t), None)
        if not rec and doi and lookup:
            rec = lookup(doi, lib, report)
        if rec:
            if num is not None:
                resolved[num] = rec
            else:
                unnumbered.append(rec)
        else:
            report["unresolved_entries"].append(text[:160])
    known = {r["key"] for r in lib.bib}
    lib.bib += [r for r in unnumbered if r["key"] not in known]
    return resolved


def doi_lookup(doi, lib, report):
    """CSL JSON for a DOI from doi.org (Crossref or DataCite), as a record; None if it does not resolve."""
    import net  # only when the reference list has DOIs that the .bib does not cover
    try:
        data = net.fetch(f"https://doi.org/{urllib.parse.quote(doi, safe='/')}", headers={"Accept": "application/vnd.citationstyles.csl+json"},
                         retries=2)
    except Exception as e:  # noqa: BLE001  (not found, network): the entry stays unresolved
        report["notes"].append(f"DOI {doi} aus der Literaturliste ließ sich nicht abrufen ({str(e)[:80]}).")
        return None
    if not isinstance(data, dict) or not data.get("title"):
        return None
    if isinstance(data.get("title"), list):
        data["title"] = data["title"][0] if data["title"] else ""
    if isinstance(data.get("container-title"), list):
        data["container-title"] = data["container-title"][0] if data["container-title"] else ""
    report["looked_up"].append(doi)
    return csl_record(data, lib.used)


# --- placeholders -> \cite ------------------------------------------------------------------------------

LOC_LABEL = {"page": "p.", "chapter": "ch.", "section": "sec.", "figure": "fig.", "table": "tab.", "paragraph": "para.",
             "line": "l.", "note": "n.", "volume": "vol.", "equation": "eq."}


def zotero_items(cit, lib):
    items = []
    for ci in cit.get("citationItems") or []:
        if not ci.get("itemData"):
            return None
        rec = lib.from_csl(ci)
        loc = str(ci.get("locator") or "").strip()
        if loc:
            label = ci.get("label") or "page"
            loc = f"{LOC_LABEL.get(label, label + '.')}~{loc}"
        items.append({"key": lib.cite(rec), "loc": loc, "pre": (ci.get("prefix") or "").strip(),
                      "suf": (ci.get("suffix") or "").strip(), "page": bool(loc) and (ci.get("label") or "page") == "page",
                      "noauthor": bool(ci.get("suppress-author"))})
    return items


def tex_loc(item, biblatex):
    loc = item["loc"]
    if not loc:
        return ""
    if biblatex and item.get("page"):
        return re.sub(r"^p\.~", "", loc)  # biblatex adds "p." itself
    return re.sub(r"^(pp?|S)\.[\s~]*", r"\1.~", loc)


def render_cite(c, style):
    items, biblatex = c["items"], style == "biblatex"
    pre = " ".join(tex_escape(i["pre"]) + " " for i in items[:1] if i["pre"])
    if biblatex:
        # Zotero's "suppress author" (the name is already in the sentence): \autocite* prints the year only
        cmd = "textcite" if c.get("narrative") else "autocite*" if all(i.get("noauthor") for i in items) and len(items) == 1 else "autocite"
        if len(items) == 1:
            it = items[0]
            loc, p = tex_loc(it, True), tex_escape(it["pre"])
            post = " ".join(filter(None, [loc, tex_escape(it["suf"])]))
            opt = f"[{p}][{post}]" if p else (f"[{post}]" if post else "")
            return f"\\{cmd}{opt}{{{it['key']}}}"
        if not any(i["loc"] or i["pre"] or i["suf"] for i in items):
            return f"\\{cmd}{{{','.join(i['key'] for i in items)}}}"
        parts = "".join(f"[{tex_escape(i['pre'])}][{' '.join(filter(None, [tex_loc(i, True), tex_escape(i['suf'])]))}]{{{i['key']}}}"
                        for i in items)
        return f"\\{cmd}s{parts}"
    # IEEE: numbers in brackets; a page goes into the bracket ([3, p. 12]), names of a narrative citation stay
    names = (c["narrative"] + " ") if c.get("narrative") else ""
    out, run = [], []  # in the order of the text: neighbours without a page share one \cite
    for i in items + [None]:
        if i and not i["loc"]:
            run.append(i["key"])
            continue
        if run:
            out.append(f"\\cite{{{','.join(run)}}}")
            run = []
        if i:
            out.append(f"\\cite[{tex_loc(i, False)}]{{{i['key']}}}")
    suf = " ".join(tex_escape(i["suf"]) for i in items if i["suf"])
    return names + pre + ", ".join(out) + (" " + suf if suf else "")


# --- LaTeX clean-up for the templates --------------------------------------------------------------------

def balanced(s, i):
    """Index after the {...} group starting at s[i] == '{'."""
    depth = 0
    for j in range(i, len(s)):
        depth += {"{": 1, "}": -1}.get(s[j], 0)
        if depth == 0:
            return j + 1
    return len(s)


def longtables_to_tables(tex):
    """IEEE's two columns do not allow longtable: each becomes a table float with a tabular."""
    out, pos = [], 0
    while True:
        i = tex.find("\\begin{longtable}", pos)
        if i < 0:
            out.append(tex[pos:])
            return "".join(out)
        j = i + len("\\begin{longtable}")
        if tex.startswith("[]", j):
            j += 2
        k = balanced(tex, j)
        spec, end = tex[j:k], tex.find("\\end{longtable}", k)
        body = tex[k:end]
        caption = ""
        c = body.find("\\caption{")
        if c >= 0:
            ce = balanced(body, c + len("\\caption"))
            caption = body[c:ce]
            body = body[:c] + re.sub(r"^\s*\\tabularnewline", "", body[ce:])
        if "\\endfirsthead" in body:
            body = body[:body.find("\\endfirsthead")] + body[body.find("\\endhead") + len("\\endhead"):]
        else:
            body = body.replace("\\endhead", "")
        foot = re.search(r"\\bottomrule(?:\\noalign\{\})?\s*\\endlastfoot", body)
        body = re.sub(r"\\bottomrule(?:\\noalign\{\})?\s*\\endlastfoot|\\endlastfoot|\\endfoot", "", body)
        body = "\n".join(line for line in body.splitlines() if line.strip())  # a blank line inside tabular is an error
        if foot:
            body += "\n\\bottomrule"
        out.append(tex[pos:i] + "\\begin{table}[htbp]\n\\centering\n" + (caption + "\n" if caption else "")
                   + f"\\begin{{tabular}}{spec}\n{body}\n\\end{{tabular}}\n\\end{{table}}")
        pos = end + len("\\end{longtable}")


def fit_images(tex, maxwidth_in):
    """Word's absolute image sizes, capped at the column/text width; aspect ratio kept."""
    unit = {"in": 1.0, "cm": 1 / 2.54, "mm": 1 / 25.4, "pt": 1 / 72.27}

    def opts(m):
        keys = [k.strip() for k in m.group(1).split(",") if k.strip() and not k.strip().startswith(("alt=", "height="))]
        out = []
        for k in keys:
            w = re.fullmatch(r"width=([\d.]+)(in|cm|mm|pt)", k)
            out.append("width=\\linewidth" if w and float(w.group(1)) * unit[w.group(2)] > maxwidth_in else k)
        if any(k.startswith("width=") for k in out) and "keepaspectratio" not in out:
            out.append("keepaspectratio")
        return "\\includegraphics" + (f"[{','.join(out)}]" if out else "")
    # alt={...} may hold commas: drop it first
    tex = re.sub(r"(\\includegraphics\[[^\]]*?),?alt=\{[^{}]*\}", r"\1", tex)
    return re.sub(r"\\includegraphics\[([^\]]*)\]", opts, tex)


def unicode_decls(tex, bib, report):
    odd = sorted({ch for ch in tex + bib if ord(ch) > 0x24F and not 0x2010 <= ord(ch) <= 0x201F})
    known = [ch for ch in odd if ch in UNICODE_TEX]
    unknown = [ch for ch in odd if ch not in UNICODE_TEX]
    if unknown:
        report["notes"].append("Zeichen, die pdflatex evtl. nicht kennt: " + " ".join(f"{c} (U+{ord(c):04X})" for c in unknown)
                               + "; mit LuaLaTeX/XeLaTeX übersetzen (Overleaf: Menu → Compiler) oder ersetzen.")
    if not known:
        return ""
    decl = "".join(f"\\DeclareUnicodeCharacter{{{ord(ch):04X}}}{{{UNICODE_TEX[ch]}}}\n" for ch in known)
    return "\\ifdefined\\DeclareUnicodeCharacter % pdflatex; XeLaTeX and LuaLaTeX read Unicode directly\n" + decl + "\\fi\n"


def author_block(authors, template):
    if template["cite"] == "ieee":
        if not authors:
            return ("\\author{\\IEEEauthorblockN{Vorname Nachname}\n\\IEEEauthorblockA{Institution\\\\\nOrt, Land\\\\\nE-Mail}}"
                    "  % TODO: Autorenangaben")
        lines = [md_to_latex(a).replace("\n", " ") for a in authors]
        return ("% TODO: Autorenangaben prüfen; aus dem Word-Text übernommen\n\\author{\\IEEEauthorblockN{" + lines[0] + "}"
                + ("\n\\IEEEauthorblockA{" + "\\\\\n".join(lines[1:]) + "}" if len(lines) > 1 else "") + "}")
    if not authors:
        return "\\author{}  % TODO: Autorenangaben"
    return "\\author{" + " \\\\\n".join(md_to_latex(a).replace("\n", " ") for a in authors) + "}"


# --- the conversion ------------------------------------------------------------------------------------------

def convert(source, kind, out, template="ieee-conference", bib_text="", lang="english", style="apa", lookup=True):
    """source: path of a .docx, or HTML/plain text pasted from Word (kind 'docx' | 'html' | 'text').

    Writes main.tex, references.bib, media/ and latex.zip to `out` and returns the report.
    """
    if template not in TEMPLATES:
        raise ConvertError(f"unbekannte Vorlage {template}")
    tpl = TEMPLATES[template]
    report = {"template": template, "source": kind, "citations": 0, "zotero_citations": 0, "sources": 0,
              "unmatched": [], "unresolved_entries": [], "looked_up": [], "notes": []}
    lib = Library(bib_text)
    if bib_text.strip() and not lib.bib:
        report["notes"].append("Die .bib-Datei enthält keine lesbaren Einträge.")
    os.makedirs(out, exist_ok=True)
    for old in ("main.tex", "references.bib", "main.pdf"):
        if os.path.exists(os.path.join(out, old)):
            os.remove(os.path.join(out, old))
    shutil.rmtree(os.path.join(out, "media"), ignore_errors=True)

    with tempfile.TemporaryDirectory() as tmp:
        tpl_path = os.path.join(tmp, "sentinel.md")
        with open(tpl_path, "w", encoding="utf-8") as f:
            f.write(SENTINEL_TEMPLATE)
        args = ["-t", "markdown-simple_tables-multiline_tables-grid_tables+pipe_tables-raw_attribute", "--wrap=none",
                "--reference-location=block", f"--template={tpl_path}"]
        fields = []
        if kind == "docx":
            path, fields, broken = prepare_docx(source, tmp)
            if broken:
                report["notes"].append(f"{broken} Zotero-Feld(er) waren nicht lesbar und bleiben als Text stehen.")
            md = run_pandoc(["-f", "docx", *args, "--extract-media=.", path], cwd=out)
        else:
            notes = []
            src = clean_word_html(source, notes) if kind == "html" else plain_to_html(source, notes)
            report["notes"] += notes
            src_path = os.path.join(tmp, "input.html")
            with open(src_path, "w", encoding="utf-8") as f:
                f.write(src)
            md = run_pandoc(["-f", "html", *args, src_path])
    meta = dict(re.findall(r"%%(TITLE|AUTHOR|ABSTRACT)\n(.*?)(?=\n%%(?:AUTHOR|ABSTRACT|BODY)\n)", md, re.S))
    meta = {k.lower(): meta.get(k, "") for k in ("TITLE", "AUTHOR", "ABSTRACT")}
    body = md.split("\n%%BODY\n", 1)[1] if "\n%%BODY\n" in md else md
    body = re.sub(r"\]\(\./media/", "](media/", body)

    # citations from Zotero fields
    citations = []
    for i, cit in enumerate(fields):
        items = zotero_items(cit, lib)
        citations.append({"items": items, "narrative": False, "plain": (cit.get("properties") or {}).get("plainCitation", "")})
    report["zotero_citations"] = sum(1 for c in citations if c["items"])

    parts, body = split_structure(meta, body, report)
    body, entries, zotero_bibl = take_reference_list(body)
    # citations written as text, matched against the .bib and the reference list (not needed after a Zotero bibliography)
    numbered = resolve_reference_list(entries, lib, report, doi_lookup if lookup else None) if entries and not zotero_bibl else {}
    texts = TextCitations(lib, numbered, citations, report)
    body = texts.apply(body)
    parts["abstract"] = texts.apply(parts["abstract"])
    if entries and zotero_bibl:
        report["notes"].append("Das Literaturverzeichnis aus Zotero wurde entfernt; die Vorlage setzt es neu.")
    elif entries:
        report["notes"].append(f"Literaturliste mit {len(entries)} Einträgen aus dem Text entfernt; die Vorlage setzt sie aus references.bib neu.")

    heads = [len(h.group(1)) for h in HEADING.finditer(body)]
    top = min(heads) if heads else 1
    body = number_headings(body, top)
    shift = 1 - top

    tex_body = md_to_latex(body, shift)
    abstract = md_to_latex(parts["abstract"])
    title = md_to_latex(parts["title"]).replace("\n", " ") if parts["title"] else "Titel"

    def sub(m):
        c = citations[int(m.group(1))]
        if not c["items"]:
            return tex_escape(c.get("plain") or "")
        return render_cite(c, tpl["cite"])
    tex_body, abstract, title = PH_RE.sub(sub, tex_body), PH_RE.sub(sub, abstract), PH_RE.sub(sub, title)
    report["citations"] = sum(1 for c in citations if c["items"])
    missing_zotero = sum(1 for c in citations[:len(fields)] if not c["items"])
    if missing_zotero:
        report["notes"].append(f"{missing_zotero} Zotero-Zitat(e) ohne Literaturdaten (alte Zotero-Version?) bleiben als Text stehen.")

    if tpl["cite"] == "ieee":
        tex_body = longtables_to_tables(tex_body)
        abstract_tex = ("\\begin{abstract}\n" + abstract + "\n\\end{abstract}\n" if abstract else "\\begin{abstract}\n% TODO: Abstract\n\\end{abstract}\n")
        if parts["keywords"]:
            abstract_tex += "\n\\begin{IEEEkeywords}\n" + md_to_latex(parts["keywords"]) + "\n\\end{IEEEkeywords}\n"
        ending = "\n\n\\bibliographystyle{IEEEtran}\n\\bibliography{references}\n\n\\end{document}\n"
    else:
        abstract_tex = "\\begin{abstract}\n" + abstract + "\n\\end{abstract}\n" if abstract else ""
        if parts["keywords"]:
            abstract_tex += "\n\\noindent\\textbf{Keywords:} " + md_to_latex(parts["keywords"]) + "\n"
        ending = "\n\n\\printbibliography\n\n\\end{document}\n"
    tex_body = fit_images(tex_body, tpl["maxwidth_in"])

    bib = "\n\n".join(r["bibtex"] for r in lib.cited.values()) + ("\n" if lib.cited else "")
    report["sources"] = len(lib.cited)
    preamble = (tpl["preamble"].replace("<<OPT>>", tpl["option"]).replace("<<STYLE>>", style).replace("<<LANG>>", lang)
                .replace("<<TITLE>>", title).replace("<<AUTHOR>>", author_block(parts["authors"], tpl))
                .replace("<<ABSTRACT>>", abstract_tex))
    tex = preamble + "\n" + tex_body + ending
    tex = tex.replace("<<COMMON>>", unicode_decls(tex, bib, report) + COMMON)
    if not lib.cited:
        tex = tex.replace("\\bibliographystyle{IEEEtran}\n\\bibliography{references}\n", "% no citations found: \\bibliographystyle{IEEEtran}\\bibliography{references}\n") \
                 .replace("\\printbibliography\n", "% \\printbibliography\n")
        report["notes"].append("Keine Zitate umgewandelt: references.bib ist leer.")

    images = re.findall(r"\\includegraphics(?:\[[^\]]*\])?\{([^}]+)\}", tex)
    odd = sorted({os.path.basename(p) for p in images if os.path.splitext(p)[1].lower() in (".emf", ".wmf", ".tif", ".tiff", ".svg")})
    if odd:
        report["notes"].append("Bildformate, die LaTeX nicht einbinden kann: " + ", ".join(odd) + "; als PNG oder PDF speichern und ersetzen.")
    report["unmatched"] = list(dict.fromkeys(u.replace("---", "\u2014").replace("--", "–") for u in report["unmatched"]))
    if kind != "docx" and not fields and not report["citations"] and not lib.bib and not entries:
        report["notes"].append("Für Zitate eine .bib-Datei aus Zotero mitgeben oder die .docx hochladen (Zotero-Felder).")

    with open(os.path.join(out, "main.tex"), "w", encoding="utf-8") as f:
        f.write(tex)
    with open(os.path.join(out, "references.bib"), "w", encoding="utf-8") as f:
        f.write(bib)
    with zipfile.ZipFile(os.path.join(out, "latex.zip"), "w", zipfile.ZIP_DEFLATED) as z:
        z.write(os.path.join(out, "main.tex"), "main.tex")
        z.write(os.path.join(out, "references.bib"), "references.bib")
        for root, _, files in os.walk(os.path.join(out, "media")):
            for name in files:
                full = os.path.join(root, name)
                z.write(full, os.path.relpath(full, out))
    report["images"] = len(images)
    report["pdf"] = build_pdf(out, tpl)
    with open(os.path.join(out, "report.json"), "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    return report


def build_pdf(out, tpl):
    if not shutil.which("latexmk"):
        return None
    res = subprocess.run(["latexmk", "-pdf", "-interaction=nonstopmode", "-quiet", "main.tex"], cwd=out, capture_output=True, text=True)
    return "main.pdf" if res.returncode == 0 else f"latexmk fehlgeschlagen (exit {res.returncode}), siehe main.log"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("input", help=".docx, or .html/.txt with text pasted from Word")
    ap.add_argument("--template", default="ieee-conference", choices=sorted(TEMPLATES))
    ap.add_argument("--bib", help="BibTeX file, e.g. a Zotero export (optional for a .docx with Zotero citations)")
    ap.add_argument("--out", help="output folder (default: <input name>-latex next to the input)")
    ap.add_argument("--lang", default="english", help="babel language for the article template, e.g. ngerman")
    ap.add_argument("--style", default="apa", choices=BIBLATEX_STYLES, help="biblatex style for the article template")
    ap.add_argument("--no-lookup", action="store_true", help="do not look up DOIs of the reference list at doi.org")
    args = ap.parse_args()
    ext = os.path.splitext(args.input)[1].lower()
    kind = "docx" if ext == ".docx" else "html" if ext in (".html", ".htm") else "text"
    if kind == "docx":
        source = os.path.abspath(args.input)
    else:
        with open(args.input, encoding="utf-8") as f:
            source = f.read()
    bib = ""
    if args.bib:
        with open(args.bib, encoding="utf-8") as f:
            bib = f.read()
    out = os.path.abspath(args.out or os.path.splitext(args.input)[0] + "-latex")
    try:
        r = convert(source, kind, out, args.template, bib, args.lang, args.style, not args.no_lookup)
    except ConvertError as e:
        sys.exit(f"Umwandlung abgebrochen: {e}")
    print(f"{out}/main.tex: Vorlage {TEMPLATES[args.template]['label']}")
    print(f"  {r['citations']} Zitate als \\cite ({r['zotero_citations']} aus Zotero-Feldern), {r['sources']} Quellen in references.bib")
    for u in r["unmatched"]:
        print(f"  nicht zugeordnet: {u}")
    for e in r["unresolved_entries"]:
        print(f"  Literatureintrag ohne Quelle: {e}")
    for n in r["notes"]:
        print(f"  Hinweis: {n}")
    print(f"{out}/latex.zip: für Overleaf (New Project -> Upload Project)")


if __name__ == "__main__":
    main()
