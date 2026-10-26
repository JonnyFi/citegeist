# Projects and planning

## Projects

A project groups sources, cards, notes, plans and texts around one goal, for example a thesis proposal. A source can belong to several projects. The project is stored in `projects/<slug>/`, and `project.md` holds the settings and the brief.

The project page has these tabs: overview, "Cards", "Planning", "Matrix", "Texts" and "Settings".

- **Overview.** The brief is Markdown. It states the research questions and the scope, and agents read it before every project task. The research questions have IDs ("RQ 1"). The overview also lists the sources of the project and its alerts.
- **Settings.** The status (active, paused, done), the citation style, the language of the AI texts and the export of the bibliography as `.bib` or CSL-JSON. citegeist keeps `exports/<slug>.bib` and `exports/<slug>.json` up to date.
- **Cards.** All quote cards of the project, with "Export" to copy several of them as direct or indirect citations.

Selecting a project in the library filter restricts the table to its sources. Alerts can belong to a project. See [literature search and alerts](literature-search-and-alerts.md).

## Planning

The "Planning" tab holds the plans of a project. A project can have several plans, for example a proposal and a paper, and they share the same sources, cards and insights. A plan lives in `projects/<slug>/plans/<plan>/`. The format and the contracts are specified in [research planning](../spec/research-planning.md).

"New plan" offers three starting points: a proposal template (introduction with problem and research questions, state of research, theoretical framework, methods and schedule), IMRaD for a paper, and an empty outline.

**Outline.** Chapters and sections form the outline, and the numbers are computed from the order. Each node has a title, a purpose in one sentence, a status (idea, draft, solid, done) and optionally research questions. You can add, rename, move, indent and remove nodes in the tree, and an agent can do the same through `edit_outline`. A section gets a document of its own once it carries claims or sources. Until then its insights live in the document of the chapter.

**Planning document.** One Markdown document per plan holds what applies across all chapters.

**Insights.** An insight is a dated paragraph with links to the sources and cards it rests on. You can write one in the "Insights" view, or say it in the chat ("I see a connection between Luhmann and Gillespie, please note it"). The agent finds the sources, writes the paragraph into the chapter it belongs to, and answers with a line saying where it went. When a plan is open, the chat looks up the insights that link to the chapter or its sources and quotes them in its answer.

**Gaps.** The "Gaps" view lists the outline nodes that have no source or no insight.

When you ask for a change in the chat ("add a subsection 4.4 to chapter 4"), the agent edits the outline and documents directly. Every change carries its origin, and "Undo" under the answer takes back the whole turn. See [ADR 0018](../decisions/0018-direct-agent-edits-with-undo.md).

## Literature matrix

The "Matrix" tab compares sources (rows) against questions (columns). A new matrix starts with the sources you choose and with columns such as "Research question", "Method" and "Result", each with an instruction for the AI. "Fill open cells" lets the AI answer each cell in one or two short sentences and name the cards or passages it rests on. The AI answers from passages of the row's source only, and citegeist checks every evidence quote against the stored text. When the passages do not answer the question, the cell stays empty. You can edit a cell by hand (it then reads "By hand"), clear it, refill it or change the instruction of a column. The matrix exports as Markdown or CSV.
