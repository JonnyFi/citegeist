---
name: citegeist
description: Search, read, quote and cite sources in the user's citegeist research library (papers, PDFs, quote cards, notes, projects stored as plain files). Use when the user asks to find sources or literature in their library, read a paper or a page of it, add a paper by DOI, arXiv ID, ISBN or URL, save a quote or create a quote card, cite with a page number, build a bibliography, or write and link notes. Triggers include "in my library", "citegeist", "add this paper", "add this paper directly to my library", "save this to my library", "quote card", "cite with page", "find sources for", "literature note", "Zettel", "which paper says", "link this note to".
compatibility: Needs the citegeist MCP server (`cg mcp`) or the `cg` command on PATH, and an initialized citegeist library.
allowed-tools: Bash(cg:*)
metadata:
  version: "0.1"
  repository: citegeist
---

# citegeist

citegeist keeps a researcher's library as plain files in one folder: sources, converted full texts, quote cards, notes and projects. The same operations are available as MCP tools and as `cg` commands. This skill tells you which to use and in what order.

## Choose the channel

1. If the tools `search`, `get_item`, `read_document` and `add_item` are available from an MCP server named citegeist, use them. They are the default.
2. Otherwise use the CLI through Bash. Always add `--json` and set your name: `cg --actor agent:<your-name> ... --json`. For long lists, pipe the output through `jq` before you read it.
3. If neither exists, tell the user to connect the server (`cg mcp`, stdio) or to install `cg`, and stop. Claude Desktop users install the `.mcpb` bundle (built with `node skills/citegeist/mcpb/build.mjs`), which starts `cg mcp` for them.

The library is found through `--library <path>`, then the environment variable `CITEGEIST_LIBRARY`, then `~/Citegeist`. A new library is created with `cg init <path>`, which only the user may run.

## Rules that always apply

- Citekeys come from `search`, `get_item` or `add_item` results. Never invent one.
- Page numbers are printed page numbers, not PDF indexes.
- The wording of a quote is verbatim. Never retype or "fix" it; copy it from `read_document` output.
- Everything you add lands in the inbox first and is stamped with your name and the reason. Pass `target: "library"` only when the user named exactly this paper, or told you to put it straight into the library.
- Fill `why` on every `add_item`. The user reads it next to the inbox item and decides from it.
- Never edit `derived/`, `sources/` or the quote of a card in the library folder. Notes and literature note bodies may be edited as files; everything else goes through the tools.
- Read `AGENTS.md` in the library root once per session if you touch files directly.

## Where your writes go

If the citegeist app is open, `cg` and `cg mcp` hand every call to it, so the app stays the single writer and shows your change at once. Without the app, the call runs in your own process, and `cg mcp` keeps watching the library folder so edits made by hand are indexed. Your name travels along in both cases. If the app is too old to take it along, writes fail with `LIBRARY_OWNED_BY_APP` and reads still work.

## Workflow: find sources

1. Search: MCP `search` with `q`, optional `kinds` (`item`, `card`, `note`, `block`), `project`, `tags`, `limit`. CLI: `cg search query "<query>" --kinds item --kinds card --limit 10 --json`.
2. Look at hits with `kind: "block"` for the page (`page`) and the snippet. Hits with `kind: "card"` are quotes the user already saved.
3. Open a promising item: MCP `get_item {citekey}`. CLI: `cg items get <citekey> --json`.
4. Report citekey, title, year and the reason it fits. If the library has nothing, say so and offer to add papers (next workflows).

## Workflow: read a document by page

1. Confirm the item has converted text: `get_item` lists sources, and a failed or running conversion shows up in `jobs_get`.
2. Read a range: MCP `read_document {citekey, pages: "31-33"}`. CLI: `cg documents read <citekey> --pages 31-33 --json`.
3. Other selectors: `section: "<heading>"` or `blocks: ["b7f3k2q"]`. Set `maxChars` to keep the answer small (default 20000).
4. If `truncated` is true, request the next page range instead of raising `maxChars`.
5. Block ids end each block in `doc.md` as `^<blockid>`; keep them if you want to link to a paragraph later.

## Workflow: add a paper

1. Choose the target. Default is the inbox. Use `target: "library"` only when the user named this paper or asked for it to go straight into the library.
2. MCP: `add_item {identifier, why, projects?, tags?, target?}`. CLI: `cg items add <identifier> --why "<reason>" --projects <slug> --json`. The identifier is a DOI, arXiv ID, ISBN, PMID, URL, BibTeX snippet or local file path.
3. The call returns at once with `citekey` and `job`. Poll `jobs_get {job}` (CLI: `cg jobs get <job> --json`) until the status is `succeeded` or `failed`. Wait a few seconds between polls.
4. If `duplicateOf` is set, the paper exists already. Use that citekey and do not add again.
5. For many DOIs use the CLI in a loop; it costs fewer tokens than one MCP call each.
6. Tell the user what landed in the inbox and why. They accept or reject it in the app (`cg inbox accept <citekey>` for the user).

## Workflow: add a paper straight to the library

Use this when the user says "add this paper directly to my library" or hands you a paper from another tool, for example a chat with a research bot.

1. Take the identifier from the message: DOI, arXiv ID or URL. If the user only names a title, search the library first, then ask for an identifier.
2. Call `add_item {identifier, target: "library", why}`. CLI: `cg --actor agent:<your-name> items add <identifier> --target library --why "<reason>" --json`.
3. Poll `jobs_get` until `succeeded`. On `failed`, read the error, apply its fix, and report what is missing (usually the full text, the metadata still exists).
4. Confirm with `get_item {citekey}` and report the citekey, the title and whether the full text arrived. The item has no `inbox` field when it sits in the library.

## Examples

A user pastes an arXiv link and says "add this paper directly to my library":

```
add_item {"identifier": "arxiv:1706.03762", "target": "library", "why": "user asked for it"}
jobs_get {"job": "j_01JB8Z3QK7ABCDEFGH"}
get_item {"citekey": "vaswani2017attention"}
```

On the shell, a list of DOIs goes to the inbox, because the user did not ask for a direct add:

```
for doi in $(cat dois.txt); do
  cg --actor agent:codex items add "$doi" --why "cited in chapter 2" --projects thesis --json
done
```

Write a note about a finding, then tie it to the paper and to a quote card:

```
create_note {"title": "Weak ties carry new information", "body": "See [[granovetter1973strength]].", "type": "permanent"}
link {"from": "n_01JB8Z3QK7ABCDEFGH", "link": {"to": "[[granovetter1973strength]]", "rel": "supports", "why": "the paper states it"}}
```

## Workflow: create a quote card

1. Find the passage with `read_document` and copy the exact wording from the output.
2. MCP `create_card {citekey, quote, anchor: {text: {exact: "<same wording>", prefix: "<text before>", suffix: "<text after>", block: "<blockid>"}}, tags?, projects?}`.
   CLI: `cg cards create <citekey> --quote "<wording>" --anchor '{"text":{"exact":"<wording>","prefix":"...","suffix":"...","block":"<blockid>"}}' --json`.
3. `prefix` and `suffix` are 20 to 40 characters on each side. They keep the anchor stable if the text is converted again.
4. The card gets an AI paraphrase and a core statement afterwards (job id in the result). Do not write those yourself.
5. The user's own words belong in the section "In my words" of the card file. Offer a draft in chat and let the user decide.

## Workflow: cite with a page locator

1. Format: MCP `cite {items: [{citekey, locator: "31"}], mode: "citation", style?, locale?, format: "text"}`.
   CLI: `cg cite format --items '[{"citekey":"luhmann1984soziale","locator":"31"}]' --json`.
2. A bibliography uses `mode: "bibliography"` with the citekeys and no locators. `format` also accepts `html`, `pandoc`, `bibtex` and `csl-json`.
3. Take the locator from a card or from the printed page you read. If the page mapping is unconfirmed, say so next to the citation.
4. Use `project` to take the style and locale of a project.

## Workflow: create and link notes

1. Create: MCP `create_note {title, body, type, projects?}`. CLI: `cg notes create --title "<claim in one sentence>" --body "<text>" --type permanent --json`. Types: `permanent`, `literature`, `question`, `claim`, `project`, `daily`.
2. Write the body with wiki links: `[[luhmann1984soziale]]` for an item, `[[c_<ULID>]]` for a card, `[[note-file-name]]` for a note.
3. Add a typed link: MCP `link {from: "n_<ULID>", link: {to: "[[luhmann1984soziale]]", rel: "supports", why: "<reason>", evidence: "[[c_<ULID>]]"}}`.
   CLI: `cg links create --from n_<ULID> --link '{"to":"[[luhmann1984soziale]]","rel":"supports","why":"..."}' --json`.
4. `rel` is one of `supports`, `opposes`, `qualifies`, `addresses`, `extends`, `uses-method-of`, `uses-data-from`, `elaborates`, `related`. Give a `why` for every link.
5. Read a project before you write notes for it: `get_project {slug}` or `cg projects get <slug> --json`.

## Errors

A failed MCP call returns `isError` with text; a failed CLI call prints the error on stderr (`--json`: `{"error": {...}}`). Both carry a code, what happened, whether a retry helps, and a safe fix on the last line. Apply the fix before you retry.

| Code | What to do |
|---|---|
| `INVALID_INPUT`, `USAGE_ERROR` | Correct the named field and call again. `cg <command> --help` lists the arguments. CLI exit code 2 or 8. |
| `ITEM_NOT_FOUND`, `NOTE_NOT_FOUND`, `PROJECT_NOT_FOUND` | Search for the right id. Do not guess a similar one. Exit code 3. |
| `IDENTIFIER_UNRESOLVABLE` | The identifier is not a DOI, arXiv ID, ISBN, PMID, URL or file. Ask the user for a better one. |
| `FORBIDDEN_ADMIN` | The operation is for humans only (reindex, init). Ask the user to run it. Exit code 4. |
| `LIBRARY_OWNED_BY_APP` | The citegeist app owns the library and cannot take your call, for example because it is an older version. Reads still work. Tell the user which change you wanted and ask them to make it in the app. Exit code 7. |
| `CORE_UNREACHABLE` | The running app did not answer. Retry in a few seconds. If it repeats, ask the user to restart the app. Exit code 5. |
| `LINK_TARGET_NOT_FOUND` | The link points at an id that does not exist. Find the citekey, card id or note id with `search` and call `link` again. |
| `LIBRARY_NOT_FOUND` | Set `CITEGEIST_LIBRARY` or `--library`, or ask the user to run `cg init <path>`. |
| `QUOTE_HASH_MISMATCH` | A card quote was edited. Do not repair it. Tell the user. |
| `ICLOUD_PLACEHOLDER`, `ICLOUD_CONFLICT` | A file is not downloaded or has a conflict copy. Ask the user to resolve it in Finder. |
| `OPERATION_NOT_IMPLEMENTED` | This build lacks the operation. Use another tool or tell the user. |
| `INTERNAL_ERROR` | Retry once. If it repeats, show the error to the user. |

Recovery values: `retry` means call again after a pause, `fix-and-retry` means change the call first, `do-first` means run the named prerequisite, `ask-human` means stop and ask the user.

## CLI exit codes

0 success, 1 internal error, 2 usage error, 3 not found, 4 not allowed for this actor, 5 retry, 6 do the prerequisite first, 7 ask the human, 8 fix the call and retry.
