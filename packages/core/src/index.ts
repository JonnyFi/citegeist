export const name = "@citegeist/core";

export * from "./agents-md/index.js";
export { CardBodyError, parseCardBody, serializeCardBody } from "./card-body.js";
export * from "./cards/index.js";
export { type Classified, classify, type FileKind } from "./classify.js";
export { MarkdownFile } from "./frontmatter.js";
export { TEMP_FILE, writeFileAtomic } from "./fsutil.js";
export { normalizeNewlines, quoteSha256, sha256Hex } from "./hash.js";
export { newCardId, newItemId, newNoteId, slugify, ulid } from "./ids.js";
export { INDEX_SCHEMA_VERSION, Index, type Scope } from "./index-db.js";
export { Indexer, type IndexResult, type IndexStatus, type SyncSummary } from "./indexer.js";
export * from "./ingest/index.js";
export {
  type ChangeEvent,
  type InitOptions,
  Library,
  type LibraryStatus,
  type OpenOptions,
} from "./library.js";
export { bindCoreOperations, createCoreRegistry } from "./ops.js";
export { type Issue, type Parsed, parseLibraryFile } from "./parse.js";
export { defaultLocalBase, LibraryPaths, LocalPaths } from "./paths.js";
export { createRuntime, type Runtime, type RuntimeOptions } from "./runtime.js";
export { type HitKind, type SearchHit, type SearchInput, search } from "./search.js";
export { snippet, stemmedText, stems, words } from "./text.js";
export { extractWikiLinks, type WikiLinkRef, wikiTarget } from "./wikilinks.js";
