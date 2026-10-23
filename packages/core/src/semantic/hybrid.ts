import type { Embedder } from "@citegeist/embed";
import type { Index } from "../index-db.js";
import { type SearchHit, type SearchInput, search } from "../search.js";
import { snippet } from "../text.js";
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
}

const QUERY_CACHE = 64;

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

    const lexical = search(this.index, { ...input, limit: pool });
    const vector = this.vectorHits(query, input, kinds, pool);
    if (vector.length === 0) return lexical.slice(0, limit);

    const lists: RankedList<SearchHit>[] = [
      { items: lexical, weight: this.opts.weights?.lexical ?? 1 },
      { items: vector, weight: this.opts.weights?.vector ?? 1 },
    ];
    return reciprocalRankFusion(lists, hitKey)
      .slice(0, limit)
      .map(({ item, score }) => ({ ...item, score }));
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
