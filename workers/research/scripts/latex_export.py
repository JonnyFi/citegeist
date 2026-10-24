#!/usr/bin/env python3
"""Turn a finished opendraft project into a LaTeX project: main.tex, references.bib, latex.zip.

    python3 latex_export.py <opendraft project folder> --style apa [--lang english]

Reads full_draft.md and research/citations.json, the files opendraft's own gate compiles. The
gate runs first, through opendraft's citations.compile_text: a draft with a {cite_MISSING: ...}
marker, a placeholder whose DOI is not in the database, or a cited DOI that is not resolved at
Crossref or DataCite stops the export, exactly as it stops final.md. Then every {cite_<doi>}
placeholder becomes \\autocite{key}; adjacent placeholders share one \\autocite. references.bib
holds only the cited sources, with opendraft's own BibTeX keys. Nothing is reworded: the text
goes through pandoc (markdown to LaTeX), the citations through this script.

Output in <project>/latex/: main.tex (biblatex with the matching style), references.bib, and
<project>/latex.zip for Overleaf (New Project -> Upload Project). If latexmk is installed,
main.pdf is built as well.

Needs pandoc (macOS: brew install pandoc; Linux: sudo apt install pandoc).
"""

import argparse
import os
import re
import shutil
import subprocess
import sys
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import settings  # noqa: E402  (only os; finds opendraft: OPENDRAFT_DIR, installed skill, or vendor/opendraft)

OPENDRAFT_DIR = settings.OPENDRAFT_DIR
# biblatex style per opendraft style; all ship with TeX Live and Overleaf
BIBLATEX = {"apa": "apa", "harvard": "authoryear", "chicago": "chicago-authordate", "mla": "mla",
            "ieee": "ieee", "vancouver": "vancouver"}
# characters pdflatex does not know through inputenc: mapped in the preamble when the paper uses them
UNICODE_TEX = {"≥": r"\ensuremath{\geq}", "≤": r"\ensuremath{\leq}", "≠": r"\ensuremath{\neq}",
               "≈": r"\ensuremath{\approx}", "±": r"\ensuremath{\pm}", "×": r"\ensuremath{\times}",
               "→": r"\ensuremath{\rightarrow}", "←": r"\ensuremath{\leftarrow}", "↔": r"\ensuremath{\leftrightarrow}",
               "⇒": r"\ensuremath{\Rightarrow}", "∼": r"\ensuremath{\sim}", "∞": r"\ensuremath{\infty}",
               "∈": r"\ensuremath{\in}", "−": r"\ensuremath{-}", "·": r"\ensuremath{\cdot}", "α": r"\ensuremath{\alpha}",
               "β": r"\ensuremath{\beta}", "γ": r"\ensuremath{\gamma}", "δ": r"\ensuremath{\delta}",
               "ε": r"\ensuremath{\epsilon}", "λ": r"\ensuremath{\lambda}", "μ": r"\ensuremath{\mu}",
               "σ": r"\ensuremath{\sigma}", "τ": r"\ensuremath{\tau}", "✓": r"\checkmark", "…": r"\ldots{}"}
GROUP = re.compile(r"\{cite_[^}]+\}(?:\s*[;,]?\s*\{cite_[^}]+\})*")
BIB_TEXT_FIELD = re.compile(r"^(  (?:title|journal|booktitle|note|publisher) = \{)(.*)(\},?)$")

PREAMBLE = r"""\documentclass[11pt,a4paper]{article}
% Built by Research Pipeline from an opendraft project (scripts/latex_export.py).
% Citations: biblatex with style=<<STYLE>>; change it below if the venue asks for another.
\usepackage[T1]{fontenc}
\usepackage[utf8]{inputenc}
\usepackage{lmodern}
\usepackage{microtype}
\usepackage[<<LANG>>]{babel}
\usepackage{csquotes}
\usepackage[margin=2.5cm]{geometry}
\usepackage{longtable,booktabs,array,calc}
\usepackage{graphicx}
\usepackage[backend=biber,style=<<STYLE>>]{biblatex}
\addbibresource{references.bib}
\usepackage[hidelinks]{hyperref}
\providecommand{\tightlist}{\setlength{\itemsep}{0pt}\setlength{\parskip}{0pt}}
\providecommand{\pandocbounded}[1]{#1}

\title{<<TITLE>>}
\author{}
\date{}

\begin{document}
\maketitle
"""


def fail(msg):
    sys.exit(f"LaTeX-Export abgebrochen: {msg}")


def load_citations_module():
    scripts = os.path.join(OPENDRAFT_DIR, "scripts")
    if not os.path.exists(os.path.join(scripts, "citations.py")):
        fail(f"opendraft nicht gefunden in {OPENDRAFT_DIR} (OPENDRAFT_DIR setzen)")
    sys.path.insert(0, scripts)  # opendraft's citations imports its own sources module
    import citations  # noqa: E402
    return citations


def pandoc(markdown, shift=0):
    exe = shutil.which("pandoc")
    if not exe:
        fail("pandoc fehlt. macOS: brew install pandoc · Linux: sudo apt install pandoc")
    cmd = [exe, "-f", "markdown", "-t", "latex", "--wrap=preserve"]
    if shift:
        cmd.append(f"--shift-heading-level-by={shift}")
    res = subprocess.run(cmd, input=markdown, capture_output=True, text=True, encoding="utf-8")
    if res.returncode != 0:
        fail(f"pandoc: {res.stderr.strip()[:400]}")
    return res.stdout.strip()


def split_draft(text):
    """(title, abstract markdown or "", body markdown, heading shift so the top body level is \\section)."""
    lines = text.splitlines()
    title = ""
    for i, line in enumerate(lines):
        if line.strip():
            if line.startswith("# "):
                title, lines = line[2:].strip(), lines[i + 1:]
            break
    body = "\n".join(lines)
    levels = [len(m.group(1)) for m in re.finditer(r"^(#{1,6}) ", body, re.M)]
    top = min(levels) if levels else 2
    if re.search(r"^#{1,6} +\d+(?:\.\d+)*\.? ", body, re.M):
        # the draft numbers its own headings: LaTeX numbers them instead, and headings the draft left
        # unnumbered (a summary, an appendix) stay unnumbered, so "Section 3" in the text still matches
        body = re.sub(r"^(#{1,6} +)(\d+(?:\.\d+)*\.? +)?(.+?)\s*$",
                      lambda h: h.group(1) + h.group(3) + ("" if h.group(2) else " {-}"), body, flags=re.M)
    abstract = ""
    m = re.search(rf"^#{{{top}}} +Abstract(?: *\{{-\}})?\s*\n(.*?)(?=^#{{1,{top}}} |\Z)", body, re.M | re.S | re.I)
    if m:
        abstract, body = m.group(1).strip(), body[:m.start()] + body[m.end():]
    return title, abstract, body, 1 - top


def bib_entries(citations, db, dois):
    """references.bib for the cited DOIs, with opendraft's keys; LaTeX specials escaped in text fields."""
    sub = {"citations": {d: db["citations"][d] for d in dois}}
    used, keys = set(), {}
    for doi in sorted(sub["citations"]):  # the order and key function citations.to_bibtex uses
        keys[doi] = citations._bibtex_key(sub["citations"][doi], used)
    out = []
    for line in citations.to_bibtex(sub).splitlines():
        m = BIB_TEXT_FIELD.match(line)
        if m:
            line = m.group(1) + re.sub(r"(?<!\\)([&%#_])", r"\\\1", m.group(2)) + m.group(3)
        out.append(line)
    return "\n".join(out) + "\n", keys


def export(project, style, lang):
    citations = load_citations_module()
    sources = sys.modules["sources"]  # opendraft's, loaded by citations
    draft_path, db_path = os.path.join(project, "full_draft.md"), os.path.join(project, "research", "citations.json")
    for p in (draft_path, db_path):
        if not os.path.exists(p):
            fail(f"{os.path.relpath(p, project)} fehlt; erst opendraft bis zum Gate laufen lassen")
    with open(draft_path, encoding="utf-8") as f:
        text = f.read()
    db = citations.load_database(db_path)
    try:
        citations.compile_text(text, db, style)  # opendraft's gate, unchanged
    except Exception as e:  # noqa: BLE001  (its own error classes, reported as they are)
        fail(f"opendrafts Gate: {e}")

    dois = sorted({sources._norm_doi(m.group(1)) for m in citations.CITE_PATTERN.finditer(text)})
    bib, keys = bib_entries(citations, db, dois)

    def cite(group):
        ks = list(dict.fromkeys(keys[sources._norm_doi(m.group(1))] for m in citations.CITE_PATTERN.finditer(group.group(0))))
        return f"\\autocite{{{','.join(ks)}}}"
    text = GROUP.sub(cite, text)

    title, abstract, body, shift = split_draft(text)
    preamble = PREAMBLE.replace("<<STYLE>>", BIBLATEX[style]).replace("<<LANG>>", lang)
    parts = [preamble.replace("<<TITLE>>", pandoc(title) if title else "")]
    if abstract:
        parts.append("\\begin{abstract}\n" + pandoc(abstract) + "\n\\end{abstract}\n")
    parts += [pandoc(body, shift), "\n\\printbibliography\n\\end{document}\n"]

    tex = "\n".join(parts)
    # beyond Latin Extended-B and the usual punctuation, pdflatex needs a mapping; unknown ones are reported
    odd = sorted({ch for ch in tex + bib if ord(ch) > 0x24F and not 0x2010 <= ord(ch) <= 0x201F})
    known = [ch for ch in odd if ch in UNICODE_TEX]
    unknown = [ch for ch in odd if ch not in UNICODE_TEX]
    if known:
        decl = "".join(f"\\DeclareUnicodeCharacter{{{ord(ch):04X}}}{{{UNICODE_TEX[ch]}}}\n" for ch in known)
        decl = "\\ifdefined\\DeclareUnicodeCharacter % pdflatex; XeLaTeX and LuaLaTeX read Unicode directly\n" + decl + "\\fi\n"
        tex = tex.replace("\\providecommand{\\tightlist}", decl + "\\providecommand{\\tightlist}", 1)
        if "\\checkmark" in decl:
            tex = tex.replace("\\usepackage{graphicx}", "\\usepackage{graphicx}\n\\usepackage{amssymb}", 1)

    out = os.path.join(project, "latex")
    os.makedirs(out, exist_ok=True)
    with open(os.path.join(out, "main.tex"), "w", encoding="utf-8") as f:
        f.write(tex)
    with open(os.path.join(out, "references.bib"), "w", encoding="utf-8") as f:
        f.write(bib)
    with zipfile.ZipFile(os.path.join(project, "latex.zip"), "w", zipfile.ZIP_DEFLATED) as z:
        for name in ("main.tex", "references.bib"):
            z.write(os.path.join(out, name), name)

    pdf = None
    if shutil.which("latexmk"):
        res = subprocess.run(["latexmk", "-pdf", "-interaction=nonstopmode", "-quiet", "main.tex"], cwd=out,
                             capture_output=True, text=True)
        pdf = os.path.join(out, "main.pdf") if res.returncode == 0 else f"latexmk failed (exit {res.returncode}), see latex/main.log"
    print(f"latex/main.tex: {len(dois)} sources cited, biblatex style={BIBLATEX[style]}, babel={lang}")
    print("latex/references.bib: only the cited sources, keys from opendraft")
    print("latex.zip: for Overleaf (New Project -> Upload Project)")
    if unknown:
        print("Warning: characters pdflatex may not know: " + " ".join(f"{ch} (U+{ord(ch):04X})" for ch in unknown)
              + "; compile with LuaLaTeX/XeLaTeX (Overleaf: Menu -> Compiler) or replace them")
    print(f"PDF: {pdf}" if pdf else "PDF: no latexmk here; compile in Overleaf or after installing TeX (brew install --cask mactex-no-gui)")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("project", help="opendraft project folder (with full_draft.md)")
    ap.add_argument("--style", required=True, choices=sorted(BIBLATEX), help="the citation style chosen at stage 6")
    ap.add_argument("--lang", default="english", help="babel language of the paper, e.g. english or ngerman")
    args = ap.parse_args()
    export(os.path.abspath(args.project), args.style, args.lang)


if __name__ == "__main__":
    main()
