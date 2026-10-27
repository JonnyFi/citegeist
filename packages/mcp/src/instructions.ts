import type { OperationContract } from "@citegeist/ops";

/** Claude Code cuts server instructions at 4,096 characters, so stay below. */
export const MAX_INSTRUCTIONS_LENGTH = 4096;

/** Instructions for the tools of one connection. Tool names come from the contracts. */
export function buildInstructions(tools: readonly OperationContract[]): string {
  const names = (list: readonly OperationContract[]) =>
    list.map((c) => c.mcp?.tool).filter((n): n is string => Boolean(n));
  const reads = names(tools.filter((c) => c.mcp?.readOnly));
  const writes = names(tools.filter((c) => !c.mcp?.readOnly));
  const text = `citegeist is the user's research library: papers, quote cards, notes and projects stored as plain files, with an index on top.

Scopes
- A read-scoped connection lists only the read-only tools: ${reads.join(", ")}.
- A write-scoped connection also lists the tools that change the library: ${writes.join(", ")}.
- Settings and every deletion beyond trash_item are not reachable through MCP. Ask the user to do them in the app or with the cg CLI.

Citekeys
- Items are addressed by citekey, for example luhmann1984soziale: lowercase letters, digits, underscore and hyphen, 2 to 80 characters.
- Take citekeys from search or add_item results. Do not invent one.
- Cards are c_<ULID>, notes n_<ULID>, jobs j_<ULID>. Projects use a lowercase slug.

Adding papers
- add_item takes a DOI, arXiv ID, ISBN, PMID, URL, BibTeX snippet or local file path.
- It defaults to the inbox, where the user reviews the paper before it joins the library. Pass target "library" only when the user asked for this paper explicitly.
- Adding something that waits in the inbox does not accept it. The answer carries inInbox: true; tell the user that the paper waits in the inbox. Only the user accepts. Search finds inbox items and marks the hits with inbox: true.
- Pass "why" to say why the paper matters. The user sees it next to the inbox item.
- related_works lists what an item cites (direction "references") or who cites it (direction "citing"), each work marked library, inbox or new. To add a work marked new, pass its DOI or arXiv ID to add_item.
- add_item returns at once with a citekey and a job id. Metadata and text arrive later. Poll jobs_get until the status is succeeded or failed.
- A URL that names a PDF is fetched and read as a PDF. If the server answers with a web page instead, add_item fails with URL_RETURNED_HTML: have the file downloaded and pass its local path.
- add_item does not add a work twice. If the library has it already (same DOI, ISBN or address, or a title that matches an item without author or year), the answer names that item in duplicateOf and fills in the metadata it lacked (enriched).
- An item without authors or year (a web page that gave no metadata, citekey like anonnd...) is repaired, not added again: call add_item with the same identifier plus its citekey, using a DOI, ISBN, arXiv ID, PMID or a URL that holds one. The identifier is stored in that item and its metadata is looked up again. Fields a person edited are kept. Never add the work a second time as a new item. The answer may carry suggestedCitekey; leave the rename to the user.
- An item whose text could not be converted is marked incomplete (get_item, search results). Repair it with attach_file (a local file) or add the same file again with add_item. trash_item removes inbox items and items an agent added, as long as no card or link refers to them.

Projects
- list_projects shows the projects, create_project makes one (slug, title, brief), get_project reads one with its plans and outline.

Reading and quoting
- read_document returns Markdown by printed page range, section or block ids, capped by maxChars. Page numbers are the printed ones, not PDF indexes.
- create_card stores a quote. The quote is verbatim and never edited. The paraphrase and the kind (thesis, finding, method, definition, example, critique) are written by AI afterwards.
- cite formats citations and bibliographies in a CSL style with locators. A source without pages (web page, HTML, EPUB) is cited by paragraph: pass label "paragraph" with the paragraph number; its cards already carry that locator.

Provenance
- Everything you write is stamped "agent:<your client name>".

Errors
- A failed call returns isError with a code, what happened, whether a retry helps, and a safe fix on the last line. Apply the fix before you retry.
`;
  if (text.length >= MAX_INSTRUCTIONS_LENGTH) {
    throw new Error(`server instructions are ${text.length} characters, the limit is 4096`);
  }
  return text;
}
