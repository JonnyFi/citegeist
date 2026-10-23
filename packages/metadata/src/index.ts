export const name = "@citegeist/metadata";

export * from "./http.js";
export * from "./identifiers.js";
export * from "./match.js";
export * from "./merge.js";
export * from "./replay.js";
export * from "./resolver.js";
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
