# Spec: Research planning

Version 2, 2026-10-24. It replaces the first draft and implements the decisions on [outline and section files](../decisions/0017-outline-and-section-files.md), [direct agent edits with undo](../decisions/0018-direct-agent-edits-with-undo.md) and [multiple plans and templates](../decisions/0019-multiple-plans-and-templates.md).

## 1. Core idea

Alex reads source X, highlights passages, writes notes, and the agent summarizes them. Later he reads text Y and suddenly sees a connection to X. This insight belongs to neither of the two literature notes alone. It belongs in a shared place: in the chapter it concerns, in the planning document or in the insights file of the project.

The spec revolves around two moments. Alex tells the agent in the chat what he sees, and the agent writes it to the right place. Later the agent brings the insight back as soon as Alex plans or restructures a chapter. Thoughts stay running text. Fixed fields exist only for the scaffold, that is the outline of chapters and sections.

## 2. Capturing in the chat

Alex opens the chat sidebar on the right and writes something like: "I see a connection between paper A and B, please note it."

1. The agent clarifies what is meant. The source being read, a highlight and the open project are part of the session context. It finds other sources, cards and notes through `search` and `list_cards`. If a detail stays ambiguous, it asks exactly one question.
2. It phrases the insight as a paragraph and sets wiki links to the citekeys, cards and outline nodes it refers to.
3. It chooses the place. If the insight concerns a chapter or a section, it goes into that document. If it spans several chapters, it goes into the planning document. If no place fits, it lands in the insights file of the project.
4. It writes the paragraph with `note_insight` and answers with one line: "Noted in 3, Luhmann's concept of communication." The line links to the paragraph and carries the "Undo" button.

Capturing is a requested change and is written directly ([ADR 0018](../decisions/0018-direct-agent-edits-with-undo.md)). Without AI, Alex writes the same paragraph by hand into the same file.

### Form of an insight

An insight is a paragraph in the Markdown text. It starts with the date and ends with a block id that the core sets when writing:

```markdown
2026-11-12: Gillespies Feedbackschleife bei Rankings ist ein Fall von Anschlusskommunikation
im Sinne von [[luhmann1984soziale]] ([[c_01JB8Z3Q]]), und [[gillespie2018custodians]] liefert
dafür den empirischen Fall. Das trägt den Übergang zu [[k_01JC7D4E2F]]. ^i-01JC5Q2M8T
```

The structure follows from the text itself. The wiki links name sources, cards and nodes, the file names the place, and the date names the time. The origin is recorded in the history of the file. The block id makes the paragraph citable, for example as `[[kommunikationsbegriff#^i-01JC5Q2M8T]]`.

## 3. Bringing insights back while planning

When Alex plans a chapter in the chat, the core calls `find_insights` for its node before the answer. The search works in two stages.

- **Links first.** Hits are paragraphs in the document of the node and its child nodes, paragraphs elsewhere in the project that link to the node, and paragraphs that link to a source or card that the document of the node links to. The core sorts these hits by the number of shared links and then by date.
- **Semantic search second.** If places remain free, the core searches all paragraphs of the project with local embeddings, and with FTS5 until those exist.

The best five enter the context of the turn with date, file, text and the reason for the hit. The session instruction requires the agent to mention an insight as soon as it touches the answer and to cite it with a block link: "For chapter 3 you noted on 12 November that A and B describe the same mechanism." The interface shows the citation as a chip. A reference to a paragraph that does not exist is marked like an unsupported citation.

For this purpose the index splits every plan file and the insights file into paragraphs and keeps block id, file, date, outgoing links and a vector per paragraph. The links go into the existing edge table of the graph.

## 4. Outline

The outline is the only object with fixed fields. It lives per plan in `outline.yaml`. Every node has these fields:

| Field | Meaning |
|---|---|
| `id` | `k_<ULID>`, stable |
| `title` | Title |
| `parent` | ID of the parent node, `null` for chapters |
| `order` | Position among siblings, integer |
| `purpose` | optional, one sentence on the purpose |
| `status` | `idea`, `draft`, `solid` or `done` |
| `questions` | IDs of the research questions from `project.md` |

```yaml
nodes:
  - { id: k_01JC2C9KQ4, title: Luhmanns Kommunikationsbegriff, parent: null, order: 3,
      purpose: Führt den Begriff ein, auf dem Kapitel 4 aufbaut., status: draft, questions: [q1] }
  - { id: k_01JC6A1B2C, title: Anschlusskommunikation, parent: k_01JC2C9KQ4, order: 1, status: idea }
```

citegeist computes numbers like "4.4" from `parent` and `order` and never stores them. Text refers to nodes by ID, for example `[[k_01JC6A1B2C]]`, and citegeist displays the link as "3.1 Anschlusskommunikation". Reordering therefore renumbers, and all links stay valid.

A chapter always has its own document. A section gets one only when it carries claims or sources ([ADR 0017](../decisions/0017-outline-and-section-files.md)); until then its insights live in the document of the chapter. In its frontmatter, a document carries only `node` and the same value under `aliases`, so that Obsidian resolves links to the node to the file. Only citegeist resolves links to sections without a document.

When Alex says "add a subsection 4.4 to chapter 4", the agent reads the computed numbers from `get_project` and creates the node through `edit_outline`. Alex can change every field in the plan view or directly in the YAML file, and he does not have to fill in any of them himself.

### Folders

```
projects/phd-proposal/
  project.md                      Project brief
  insights.md                     Insights without a fixed place
  plans/
    proposal/
      plan.md                     Planning document
      outline.yaml                Outline
      nodes/kommunikationsbegriff.md
      nodes/autopoiesis.md        Section with sources, hence its own document
    paper-plattformen/
      plan.md
      outline.yaml
  proposals/p_01JC4M7R2X.json     Proposals for unrequested agent changes
```

A project can have several plans ([ADR 0019](../decisions/0019-multiple-plans-and-templates.md)). On creation, the templates "Exposé" and "IMRaD" are available, which fill `outline.yaml` with nodes and purposes.

## 5. Changes by the agent

- **The agent writes changes requested in the chat directly.** If Alex says "that's how I want it, put it into words", the text appears in the document immediately.
- **Every change can be undone.** Before every write, the core stores the previous version in the history of the file, with actor and agent turn. "Undo" restores all files of a turn. If Alex made changes in between, the core merges both states with a three-way merge and shows conflicts. The history lives machine-locally under Application Support; across devices, git helps ([ADR 0005](../decisions/0005-sync-and-versioning.md)).
- **The review mode is selectable.** Per project (`agent_edits: review`) or per chat, changes arrive as a proposal with a diff.
- **Unrequested changes arrive as a proposal.** This applies to background jobs and to external agents outside a citegeist chat.

## 6. Contracts

- `insights.note` (write, MCP `note_insight`): `project`, `plan?`, `target` (node ID, `plan` or `project`), `text`. The core sets date and block id. Output `path`, `block`, `number` of the node.
- `insights.find` (read, MCP `find_insights`): `project`, `plan?`, `node?`, `refs?`, `query?`, `limit = 5`. Output paragraphs with `path`, `block`, `date`, `text`, `stage` (`links` or `semantic`) and `why`.
- `plans.create` (write): `project`, `slug`, `title`, `template?: "expose" | "imrad"`. `plans.list` (read): `project`.
- `outline.get` (read, MCP through `get_project`, which returns project, plans and outline in one call): `project`, `plan`. Output nodes with fields, computed number and path of the document.
- `outline.apply` (write, MCP `edit_outline`): `project`, `plan`, `ops` made of `add` (`parent`, `position`, `title`, `purpose?`), `update` (`id`, fields), `move` (`id`, `parent`, `position`) and `remove` (`id`). One call is atomic and one step in the history. `remove` of a node with a document or incoming links reports them and requires `force`.
- `plan.docs.update` (write, MCP `edit_plan_doc`): `project`, `plan`, `doc`, `baseHash`, `body`. Creates the document of a node when needed.
- `history.list`, `history.restore`, `history.revertTurn` (write): history of a file, restore a version, undo an agent turn.
- `proposals.list`, `proposals.decide` (write): view proposals, accept or reject them.

Actor, chat turn and review mode decide for every writing operation whether it writes directly or creates a proposal.

Schema in `packages/schema/src/planning.ts`: `PlanSlug`, `OutlineNodeId`, `OutlineNode`, `Outline`, `PlanFrontmatter` (`title`, `template?`, `created`), `NodeDocFrontmatter` (`node`, `aliases`). The planned `Proposal` and `HistoryEntry` schemas and `agent_edits` in `ProjectFrontmatter` (default `direct`) are not implemented yet. [library-format.md](library-format.md) lists `insights.md` and `plans/`.

Implementation status: `insights.note`, `insights.find`, `plans.create`, `plans.list`, `outline.get`, `outline.apply` and `plan.docs.update` exist. Undoing an agent turn is implemented as `chat.revertTurn`, backed by the turn journal of the chat package. The per-file history operations (`history.*`), proposals (`proposals.*`) and the review mode are not implemented yet.

## 7. Interface

- **Chat sidebar:** confirmation line after capturing, cited insights as chips with date, "Undo" on every agent turn with changes.
- **Plan view:** one tab per plan. On the left is the outline with computed numbers, with "Planning document" above it and "Project insights" below it. In the middle is the document of the selected node in the editor, with a small form above it for title, purpose, status and research questions.
- **History:** per file a list of versions with their origin.

The literature matrix filters to the sources that the document of a node links to. The later writing desk takes over the outline.

## 8. Prior art

- **Obsidian Longform:** The order lives in an index file, separate from the texts. citegeist adopts the separation with `outline.yaml` ([Scene Subtree Mover](https://community.obsidian.md/plugins/scene-subtree-mover)).
- **STORM:** The outline emerges from questions before text exists. The planning agent likewise asks first ([Stanford](https://storm-project.stanford.edu/research/storm/)).
- **Jenni AI:** It inserts citations from a third-party database. citegeist backs claims with the user's own cards and insights ([eesel](https://www.eesel.ai/blog/jenni-ai-writing-tool)).

## 9. Delivery order

The first cut covers plans and insights as well as capturing: `note_insight` with the three places, the paragraph split in the index, `find_insights` with the link stage, and history with "Undo". Until the sidebar exists, the same flow runs with Claude Code over MCP. The outline, the retrieval in the planning chat and the plan view follow.

## 10. Open questions

1. **How long does the history keep versions?** Recommendation: 90 days for all versions, then one per day.
2. **Should the agent also bring insights back while reading, for example when opening source B?** Recommendation: only in the planning chat at first, later as a quiet hint in the reader.
