import type { HttpClient } from "../http.js";
import { isoDate } from "../text.js";
import type {
  Enrichment,
  MetadataConfig,
  MetadataFields,
  SourceName,
  SourceRecord,
} from "../types.js";

/** What every source needs: the shared client, the user config and a clock. */
export interface SourceContext {
  http: HttpClient;
  config: MetadataConfig;
  /** Unix ms. */
  now: () => number;
}

/** Appends `mailto` when the user configured one. The cache key helpers drop it again. */
export function withMailto(url: string, config: MetadataConfig): string {
  if (!config.mailto) return url;
  const u = new URL(url);
  u.searchParams.set("mailto", config.mailto);
  return u.toString();
}

/** DOI as URL path: slashes stay, everything else is percent-encoded. */
export function doiPath(doi: string): string {
  return encodeURIComponent(doi).replace(/%2F/gi, "/");
}

export function makeRecord(
  source: SourceName,
  recordId: string,
  fetchedAtMs: number,
  fields: MetadataFields,
  enrichment?: Enrichment,
): SourceRecord {
  const rec: SourceRecord = { source, recordId, fetchedAt: isoDate(fetchedAtMs), fields };
  if (enrichment && Object.keys(enrichment).length > 0) rec.enrichment = enrichment;
  return rec;
}
