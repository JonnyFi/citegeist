import type { Embedder, Reranker } from "@citegeist/embed";
import type { Index } from "../index-db.js";
import { type SearchHit, type SearchInput, search } from "../search.js";
import { snippet } from "../text.js";
import { MAX_CHUNK_CHARS } from "./chunks.js";
import { type RankedList, reciprocalRankFusion } from "./fusion.js";
import { SemanticStore, type SyncOptions, type SyncReport, type VectorHit } from "./store.js";

export interface SemanticOptions {
  /**
   * Vector hits below this cosine similarity are ignored, so a query that matches nothing in the
   * library does not drag in the least bad neighbours. Default 0.3.
   */
  minSimilarity?: number;
  /** Weight of the full-text list and of the vector list in the fusion. Default 1 each. */
  weights?: { lexical?: number; vector?: number };
  /** Candidates taken from each side before fusion, as a multiple of `limit`. Default 4. */
  pool?: number;
  /**
   * A cross-encoder that re-sorts the best fused candidates. Off when absent. The score of a
   * reranked hit is the reranker's, squashed into 0 to 1.
   */
  reranker?: Reranker | undefined;
  /** How many fused candidates the reranker sees (at least `limit`). Default 30. */
  rerankTop?: number;
}

const QUERY_CACHE = 64;
const RERANK_TOP = 30;

const hitKey = (h: Pick<SearchHit, "kind" | "citekey" | "id">): string =>
  `${h.kind}\0${h.citekey ?? ""}\0${h.id}`;

/**
 * Hybrid search for one index: full-text hits from `search()` and nearest vectors, merged by
 * reciprocal rank fusion. With no vectors for the current model, or when the query cannot be
 * embedded, it returns exactly the full-text result.
 */
export class SemanticSearch {
  readonly store: SemanticStore;
  private readonly cache = new Map<string, Float32Array>();

  constructor(
    private readonly index: Index,
    private readonly embedder: Embedder,
    private readonly opts: SemanticOptions = {},
  ) {
    this.store = new SemanticStore(index);
  }

  /** True when searches currently use the vectors. */
  get active(): boolean {
    return this.store.ready(this.embedder);
  }

  /** Embeds what is new or changed in the index and drops vectors of what is gone. */
  sync(opts: SyncOptions = {}): Promise<SyncReport> {
    return this.store.sync(this.embedder, opts);
  }

  /** Same contract as `search()`, plus a vector side when vectors exist. */
  async search(input: SearchInput, signal?: AbortSignal): Promise<SearchHit[]> {
    const limit = input.limit ?? 20;
    const kinds = input.kinds ?? ["item", "card", "note", "block"];
    if (!this.active || kinds.length === 0) return search(this.index, input);

    const pool = limit * (this.opts.pool ?? 4);
    let query: Float32Array;
    try {
      query = await this.queryVector(input.q, signal);
    } catch (err) {
      if (signal?.aborted) throw err;
      return search(this.index, input);
    }

    // The reranker needs a longer list than the caller asked for; it cuts back to `limit`.
    const want = this.opts.reranker ? Math.max(limit, this.opts.rerankTop ?? RERANK_TOP) : limit;
    const lexical = search(this.index, { ...input, limit: Math.max(pool, want) });
    const vector = this.vectorHits(query, input, kinds, Math.max(pool, want));
    if (vector.length === 0) return this.rerank(input.q, lexical.slice(0, want), limit, signal);

    const lists: RankedList<SearchHit>[] = [
      { items: lexical, weight: this.opts.weights?.lexical ?? 1 },
      { items: vector, weight: this.opts.weights?.vector ?? 1 },
    ];
    const fused = reciprocalRankFusion(lists, hitKey)
      .slice(0, want)
      .map(({ item, score }) => ({ ...item, score }));
    return this.rerank(input.q, fused, limit, signal);
  }

  /** Re-sorts `hits` by the reranker and keeps `limit`. Without a reranker, or when it fails, the fused order stands. */
  private async rerank(
    q: string,
    hits: SearchHit[],
    limit: number,
    signal?: AbortSignal,
  ): Promise<SearchHit[]> {
    const reranker = this.opts.reranker;
    if (!reranker || hits.length < 2) return hits.slice(0, limit);
    try {
      const scores = await reranker.rerank(
        q,
        hits.map((h) => this.passage(h)),
        signal ? { signal } : {},
      );
      return hits
        .map((hit, i) => ({ hit, s: scores[i] ?? Number.NEGATIVE_INFINITY }))
        .sort((a, b) => b.s - a.s)
        .slice(0, limit)
        .map(({ hit, s }) => ({ ...hit, score: 1 / (1 + Math.exp(-s)) }));
    } catch (err) {
      if (signal?.aborted) throw err;
      return hits.slice(0, limit);
    }
  }

  /** What the reranker reads for a hit: the title of the document and the start of its text. */
  private passage(hit: SearchHit): string {
    const where =
      hit.kind === "block"
        ? {
            sql: "d.kind = 'block' AND d.citekey = ? AND d.ref LIKE ?",
            params: [hit.citekey, `%:${hit.id}`],
          }
        : { sql: "d.kind = ? AND d.ref = ?", params: [hit.kind, hit.id] };
    const body =
      this.index.get<{ body: string }>(
        `SELECT f.body FROM docs d JOIN fts_tri f ON f.rowid = d.id WHERE ${where.sql} LIMIT 1`,
        ...where.params,
      )?.body ?? hit.snippet;
    return `${hit.title}\n${body.slice(0, MAX_CHUNK_CHARS)}`;
  }

  private async queryVector(q: string, signal?: AbortSignal): Promise<Float32Array> {
    const cached = this.cache.get(q);
    if (cached) {
      this.cache.delete(q);
      this.cache.set(q, cached);
      return cached;
    }
    const v = await this.embedder.embedQuery(q, signal ? { signal } : {});
    this.cache.set(q, v);
    if (this.cache.size > QUERY_CACHE) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    return v;
  }

  /** Nearest chunks collapsed to one hit per document, best chunk first. */
  private vectorHits(
    query: Float32Array,
    input: SearchInput,
    kinds: string[],
    pool: number,
  ): SearchHit[] {
    const floor = this.opts.minSimilarity ?? 0.3;
    // Several chunks of one document may be near; ask for more chunks than documents.
    const chunks = this.store.nearest(query, { ...input, kinds }, pool * 3);
    const seen = new Set<string>();
    const out: SearchHit[] = [];
    for (const c of chunks) {
      if (c.similarity < floor) continue;
      const docKey = `${c.path}\0${c.kind}\0${c.ref}`;
      if (seen.has(docKey)) continue;
      seen.add(docKey);
      const hit = this.toHit(c, input.q);
      if (hit) out.push(hit);
      if (out.length >= pool) break;
    }
    return out;
  }

  private toHit(c: VectorHit, q: string): SearchHit | undefined {
    const doc = this.index.get<{ title: string }>(
      "SELECT title FROM docs WHERE path = ? AND kind = ? AND ref = ?",
      c.path,
      c.kind,
      c.ref,
    );
    if (!doc) return undefined;
    const isBlock = c.kind === "block";
    const sep = c.ref.indexOf(":");
    const hit: SearchHit = {
      kind: c.kind as SearchHit["kind"],
      id: isBlock ? c.ref.slice(sep + 1) : c.ref,
      title: doc.title,
      snippet: snippet(c.text, q),
      score: c.similarity,
    };
    if (c.citekey) hit.citekey = c.citekey;
    if (isBlock && c.citekey) {
      hit.title =
        this.index.get<{ title: string }>("SELECT title FROM items WHERE citekey = ?", c.citekey)
          ?.title ?? c.citekey;
      const page = this.index.get<{ page: string | null }>(
        "SELECT page FROM blocks WHERE citekey = ? AND source = ? AND id = ?",
        c.citekey,
        c.ref.slice(0, sep),
        c.ref.slice(sep + 1),
      )?.page;
      if (page) hit.page = page;
    }
    return hit;
  }
}
