/**
 * Types of the alert lookups: new works of an arXiv category or query, an OpenAlex topic or
 * search, an author, or the works that cite one work. The resolver implements `AlertLookup`; the
 * core takes it as a dependency so tests can pass a fake.
 */

import type { WorkKey, WorkRef } from "./graph-types.js";

export const ALERT_SOURCE_KINDS = [
  "arxiv-category",
  "arxiv-query",
  "openalex-topic",
  "openalex-search",
  "author",
  "cites",
] as const;
export type AlertSourceKind = (typeof ALERT_SOURCE_KINDS)[number];

/** A work an alert found. Carries the abstract so that the core can rank it against a brief. */
export interface AlertWork extends WorkRef {
  abstract?: string;
  /** ISO date of the first publication, YYYY-MM-DD. */
  published?: string;
}

export type AlertQuery = { since: string; limit: number } & (
  | { kind: "arxiv-category"; category: string }
  | { kind: "arxiv-query"; query: string }
  | { kind: "openalex-topic"; topic: string }
  | { kind: "openalex-search"; query: string }
  | { kind: "author"; author: string }
  | { kind: "cites"; key: WorkKey }
);

export interface AlertLookup {
  /**
   * Works published on or after `since` (YYYY-MM-DD), newest first, at most `limit`. Throws a
   * SourceError when the source does not answer.
   */
  alertWorks(query: AlertQuery): Promise<AlertWork[]>;
}
