# Writing and export

## Texts

The "Texts" tab of a project holds the texts you write in citegeist. A text is a Markdown file in `projects/<slug>/texts/` with a small frontmatter for the title, the citation style and the language. The file format is described in [the library format spec](../spec/library-format.md).

"New text" asks for a title and creates the file. A text uses the citation style and language of the project unless you set its own. The citation styles shipped with citegeist are APA, Chicago (author-date) and DGPs.

Citations use Pandoc syntax: `[@luhmann1984soziale, p. 31]`. Typing `[@` opens a list of the sources in your library, with the sources of the project first. Pick one, and citegeist inserts the citekey. You type the locator yourself. A citekey that the library does not know is underlined, and a line under the editor lists unknown keys.

The card column next to the editor lists the cards of the project. "Quote verbatim" inserts the wording with its citation at the cursor, and "Quote indirectly" inserts the note or paraphrase with a "cf." citation. Texts are plain Markdown, so the chat agent can write into them as well. It drafts and revises passages directly in the file, and "Undo" under its answer takes back the turn. `cg texts` offers the same operations in a shell: `list`, `get`, `create`, `update` and `export`.

## Export

The export bar offers four formats. Each export goes to `projects/<slug>/exports/`.

| Format | Result |
|---|---|
| Word | A `.docx` file with the citations and the bibliography in the citation style. |
| LaTeX | A ZIP with `main.tex` and `references.bib`, for example for Overleaf. The citations stay biblatex commands. |
| PDF | A4 PDF, 11 pt serif font, margins of 2.5 cm, typeset with Typst. |
| Markdown | Markdown with the citations resolved. |

The bibliography lists only the sources the text cites. An unknown citekey stays unresolved in the output, and the export bar names it.

citegeist runs Pandoc as a separate process. It looks for Pandoc in your `PATH` and in the Homebrew folders. If it finds none, the export bar offers "Download Pandoc". That fetches a pinned release from GitHub into `~/Library/Application Support/citegeist/pandoc/<version>` and verifies a fixed checksum. `cg pandoc status` shows which Pandoc and which PDF engine citegeist uses, and `cg pandoc setup` downloads the release. A different route is `brew install pandoc`.

For a PDF, citegeist typesets with Typst. The first time you choose PDF and Typst is missing, the export bar asks whether it may download it (about 14 MB, a pinned release with a fixed checksum, stored in `~/Library/Application Support/citegeist/typst/<version>`) and exports once the download is done. `cg typst status` shows which Typst citegeist uses, and `cg typst setup` downloads the release. A different route is `brew install typst`. Hyphenation follows the language of the text. Only on a Mac with a LaTeX engine (xelatex, lualatex, tectonic or pdflatex) and without Typst does citegeist fall back to that engine. Word, LaTeX and Markdown need no engine.

## Other routes to a citation

- Copy a card as a verbatim or indirect citation. See [reading and cards](reading-and-cards.md).
- Use the quick insert hotkey to paste a citation into any other app, for example a Google Docs document.
- Use the `.bib` and CSL-JSON files that citegeist keeps up to date for each project, with a reference manager or a LaTeX project of your own.

LaTeX is an export target in citegeist. There is no visual editor, and there are no add-ins for Word or Google Docs. See [ADR 0002](../decisions/0002-writing-in-markdown-with-pandoc.md).
