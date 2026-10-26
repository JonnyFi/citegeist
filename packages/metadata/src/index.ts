export const name = "@citegeist/metadata";

export * from "./alert-types.js";
export * from "./graph-types.js";
export * from "./http.js";
export * from "./identifiers.js";
export * from "./match.js";
export * from "./merge.js";
export * from "./replay.js";
export * from "./resolver.js";
export { arxivSearchQuery, openAlexAuthorFilter, openAlexTopicId } from "./sources/alerts.js";
export { arxivFromDoi, mapCrossrefReference, mapOpenAlexRef } from "./sources/citations.js";
export { openAccessPdfUrls } from "./sources/openalex.js";
export { parsePubmedXml, pubmedUrl } from "./sources/pubmed.js";
export { mapUnpaywall } from "./sources/unpaywall.js";
export type {
  Creator,
  Enrichment,
  FieldName,
  MetadataConfig,
  MetadataFields,
  SourceName,
  SourceRecord,
} from "./types.js";
export { SourceError } from "./types.js";
export * from "./web.js";
