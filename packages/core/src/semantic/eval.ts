import { readFileSync } from "node:fs";
import type { Index } from "../index-db.js";
import type { SearchHit } from "../search.js";

/**
 * What a query should find. `item` is the citekey of the item. With `contains`, only a block of
 * that item whose text includes the string counts (whitespace and case do not matter); without
 * it, any hit of the item counts.
 */
export interface Expectation {
  item: string;
  contains?: string;
}

export interface EvalQuery {
  id: string;
  /** "de" or "en". Only used to group the report. */
  lang?: string;
  /** "keyword" (a few content words) or "conceptual" (a paraphrased question). */
  kind?: string;
  q: string;
  /** The query is answered when any of these is found. */
  expect: Expectation[];
}

export interface QueryResult {
  id: string;
  lang?: string;
  kind?: string;
  q: string;
  /** Rank of the first block hit that matches an expectation, 0 when it is not in the list. */
  rank: number;
  /** Rank of the first hit of an expected item (any block of it), 0 when none. */
  itemRank: number;
}

export interface Metrics {
  queries: number;
  /** Share of queries whose answer is among the first k hits (0 to 1). */
  hit1: number;
  hit3: number;
  hit5: number;
  hit10: number;
  /** Mean reciprocal rank over the list the search returned. */
  mrr: number;
  /** hit@5 on the item only, ignoring which block. */
  itemHit5: number;
}

const squash = (s: string): string => s.replace(/\s+/g, " ").trim().toLowerCase();

/** Reads a queries file: a JSON array, or an object with a `queries` array. */
export function loadQueries(file: string): EvalQuery[] {
  const raw = JSON.parse(readFileSync(file, "utf8")) as unknown;
  const list = Array.isArray(raw) ? raw : (raw as { queries?: unknown }).queries;
  if (!Array.isArray(list)) throw new Error(`${file}: expected an array or { "queries": [...] }`);
  return list.map((entry, i) => {
    const e = entry as Partial<EvalQuery>;
    if (typeof e.q !== "string" || !Array.isArray(e.expect) || e.expect.length === 0) {
      throw new Error(`${file}: query ${i + 1} needs "q" and a non-empty "expect"`);
    }
    for (const x of e.expect) {
      if (typeof x?.item !== "string") throw new Error(`${file}: query ${i + 1}: "item" missing`);
    }
    return { ...e, id: e.id ?? `q${i + 1}` } as EvalQuery;
  });
}

/** Checks hits against the expectations of a query. Block texts come from the index. */
export class Judge {
  private readonly texts = new Map<string, string>();

  constructor(private readonly index: Index) {}

  private blockText(citekey: string, id: string): string {
    const key = `${citekey}\0${id}`;
    let t = this.texts.get(key);
    if (t === undefined) {
      t = squash(
        this.index.get<{ text: string }>(
          "SELECT text FROM blocks WHERE citekey = ? AND id = ?",
          citekey,
          id,
        )?.text ?? "",
      );
      this.texts.set(key, t);
    }
    return t;
  }

  /** Number of blocks of the item that satisfy the expectation (0 means the query is stale). */
  matches(x: Expectation): number {
    if (x.contains === undefined) {
      return (
        this.index.get<{ n: number }>("SELECT COUNT(*) AS n FROM items WHERE citekey = ?", x.item)
          ?.n ?? 0
      );
    }
    const needle = squash(x.contains);
    return this.index
      .all<{ text: string }>("SELECT text FROM blocks WHERE citekey = ?", x.item)
      .filter((b) => squash(b.text).includes(needle)).length;
  }

  hitMatchesItem(hit: SearchHit, x: Expectation): boolean {
    return hit.citekey === x.item;
  }

  hitMatches(hit: SearchHit, x: Expectation): boolean {
    if (hit.citekey !== x.item) return false;
    if (x.contains === undefined) return true;
    if (hit.kind !== "block") return false;
    return this.blockText(hit.citekey, hit.id).includes(squash(x.contains));
  }

  judge(query: EvalQuery, hits: SearchHit[]): QueryResult {
    const at = (pred: (h: SearchHit, x: Expectation) => boolean): number => {
      const i = hits.findIndex((h) => query.expect.some((x) => pred(h, x)));
      return i < 0 ? 0 : i + 1;
    };
    const result: QueryResult = {
      id: query.id,
      q: query.q,
      rank: at((h, x) => this.hitMatches(h, x)),
      itemRank: at((h, x) => this.hitMatchesItem(h, x)),
    };
    if (query.lang) result.lang = query.lang;
    if (query.kind) result.kind = query.kind;
    return result;
  }
}

export function metrics(results: QueryResult[]): Metrics {
  const n = results.length || 1;
  const at = (k: number, key: "rank" | "itemRank" = "rank"): number =>
    results.filter((r) => r[key] > 0 && r[key] <= k).length / n;
  return {
    queries: results.length,
    hit1: at(1),
    hit3: at(3),
    hit5: at(5),
    hit10: at(10),
    mrr: results.reduce((s, r) => s + (r.rank > 0 ? 1 / r.rank : 0), 0) / n,
    itemHit5: at(5, "itemRank"),
  };
}

/** Runs every query through `searchFn` and judges the hits. */
export async function runQueries(
  queries: EvalQuery[],
  judge: Judge,
  searchFn: (q: string) => Promise<SearchHit[]>,
): Promise<{ results: QueryResult[]; latencyMs: number[] }> {
  const results: QueryResult[] = [];
  const latencyMs: number[] = [];
  for (const query of queries) {
    const t0 = performance.now();
    const hits = await searchFn(query.q);
    latencyMs.push(performance.now() - t0);
    results.push(judge.judge(query, hits));
  }
  return { results, latencyMs };
}

export function formatMetrics(m: Metrics): string {
  const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;
  return `hit@1 ${pct(m.hit1)}  hit@3 ${pct(m.hit3)}  hit@5 ${pct(m.hit5)}  hit@10 ${pct(m.hit10)}  MRR ${m.mrr.toFixed(3)}  (item hit@5 ${pct(m.itemHit5)}, ${m.queries} queries)`;
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0;
}
