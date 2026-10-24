export const name = "@citegeist/import";

export { DuplicateIndex, type DuplicateMatch, type DuplicateReason } from "./dupes.js";
export { type ExecuteDeps, executePlan } from "./execute.js";
export { bundleFromFile, extractBibFiles, type GenericDeps, matchPdfs } from "./generic.js";
export { createLibraryHost, type LibraryLike } from "./host.js";
export { htmlToMarkdown, noteTitle } from "./html.js";
export { buildFrontmatter, mergeFrontmatter } from "./merge.js";
export {
  bindImportOperations,
  type ImportDeps,
  type ImportJobContext,
  type ImportQueuePort,
  loadBundle,
  previewImport,
} from "./ops.js";
export { buildPlan, type Plan, type PlannedItem, toReport } from "./plan.js";
export type {
  ExistingItem,
  ImportHost,
  SourceAnnotation,
  SourceAttachment,
  SourceBundle,
  SourceItem,
  SourceNote,
} from "./types.js";
export { annotationToCard, type CardDraft, parsePdfPosition } from "./zotero/annotations.js";
export { readZoteroApi } from "./zotero/api.js";
export { bundleFromZotero, itemToDraft, parseExtra, zoteroDateParts } from "./zotero/convert.js";
export { readZoteroSqlite } from "./zotero/sqlite.js";
