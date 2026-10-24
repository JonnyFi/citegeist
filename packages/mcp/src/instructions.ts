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
- Settings and deletion without trash are not reachable through MCP. Ask the user to do them in the app or with the cg CLI.

Citekeys
- Items are addressed by citekey, for example luhmann1984soziale: lowercase letters, digits, underscore and hyphen, 2 to 80 characters.
- Take citekeys from search or add_item results. Do not invent one.
- Cards are c_<ULID>, notes n_<ULID>, jobs j_<ULID>. Projects use a lowercase slug.

Adding papers
- add_item takes a DOI, arXiv ID, ISBN, PMID, URL, BibTeX snippet or local file path.
- It defaults to the inbox, where the user reviews the paper before it joins the library. Pass target "library" only when the user asked for this paper explicitly.
- Pass "why" to say why the paper matters. The user sees it next to the inbox item.
- related_works lists what an item cites (direction "references") or who cites it (direction "citing"), each work marked library, inbox or new. To add a work marked new, pass its DOI or arXiv ID to add_item.
- add_item returns at once with a citekey and a job id. Metadata and text arrive later. Poll jobs_get until the status is succeeded or failed.

Reading and quoting
- read_document returns Markdown by printed page range, section or block ids, capped by maxChars. Page numbers are the printed ones, not PDF indexes.
- create_card stores a quote. The quote is verbatim and never edited. The paraphrase and the kind (thesis, finding, method, definition, example, critique) are written by AI afterwards.
- cite formats citations and bibliographies in a CSL style with locators.

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
