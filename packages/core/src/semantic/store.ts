import type { Embedder } from "@citegeist/embed";
import * as sqliteVec from "sqlite-vec";
import { type Index, type Scope, scopeClauses } from "../index-db.js";
import { type Chunk, collectChunks } from "./chunks.js";

export interface SyncOptions {
  signal?: AbortSignal | undefined;
  /** Chunks per model call. Default 16. */
  batchSize?: number | undefined;
  onProgress?: ((done: number, total: number) => void) | undefined;
}

export interface SyncReport {
  /** Chunks the index wants vectors for. */
  chunks: number;
  /** Chunks embedded in this run (new or changed text). */
  embedded: number;
  /** Stored vectors dropped because their chunk is gone. */
  removed: number;
  /** True when a model change made the store start from scratch. */
  rebuilt: boolean;
}

export interface VectorFilter extends Scope {
  kinds: string[];
}

export interface VectorHit {
  kind: string;
  ref: string;
  path: string;
  citekey: string | null;
  seq: number;
  text: string;
  /** Cosine similarity, 1 is identical. */
  similarity: number;
}

interface ChunkRow {
  id: number;
  path: string;
  kind: string;
  ref: string;
  seq: number;
  hash: string;
}

const key = (c: { path: string; kind: string; ref: string; seq: number }): string =>
  `${c.path}\0${c.kind}\0${c.ref}\0${c.seq}`;

/**
 * Vectors for the chunks of one index, in the same SQLite file (tables `sem_*`, vectors in a
 * sqlite-vec `vec0` table). Everything in it can be rebuilt from the index, so a model change,
 * a new dimension or a rebuilt index only costs a re-embed.
 *
 * Rows are keyed by (path, kind, ref, seq) and not by the index's own row ids, because those
 * change on every rebuild.
 */
export class SemanticStore {
  /** False when the sqlite-vec extension could not be loaded; search then stays full-text only. */
  readonly available: boolean;
  readonly loadError: string | undefined;
  private modelId: string | undefined;

  constructor(private readonly index: Index) {
    let ok = false;
    let error: string | undefined;
    try {
      sqliteVec.load(index.db);
      ok = true;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
    this.available = ok;
    this.loadError = error;
    if (ok) {
      index.db.exec(`
        CREATE TABLE IF NOT EXISTS sem_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS sem_chunks (
          id INTEGER PRIMARY KEY, path TEXT NOT NULL, kind TEXT NOT NULL, ref TEXT NOT NULL,
          citekey TEXT, seq INTEGER NOT NULL, hash TEXT NOT NULL, text TEXT NOT NULL,
          UNIQUE (path, kind, ref, seq)
        );
        CREATE INDEX IF NOT EXISTS sem_chunks_doc ON sem_chunks(path, kind, ref);
      `);
      this.modelId = this.meta("model");
    }
  }

  private meta(k: string): string | undefined {
    return this.index.get<{ value: string }>("SELECT value FROM sem_meta WHERE key = ?", k)?.value;
  }

  private setMeta(k: string, v: string): void {
    this.index.db.prepare("INSERT OR REPLACE INTO sem_meta(key, value) VALUES (?, ?)").run(k, v);
  }

  /** Id of the model the stored vectors came from. */
  get model(): string | undefined {
    return this.modelId;
  }

  /** Number of stored vectors. */
  count(): number {
    if (!this.available) return 0;
    return this.index.get<{ n: number }>("SELECT COUNT(*) AS n FROM sem_chunks")?.n ?? 0;
  }

  /** True when vectors from this embedder exist, which is what makes search hybrid. */
  ready(embedder: Pick<Embedder, "id">): boolean {
    return this.available && this.modelId === embedder.id && this.count() > 0;
  }

  /** Drops every vector. */
  clear(): void {
    if (!this.available) return;
    this.index.db.exec(
      "DROP TABLE IF EXISTS sem_vec; DELETE FROM sem_chunks; DELETE FROM sem_meta",
    );
    this.modelId = undefined;
  }

  /** Makes the vector table match the embedder. Returns true when old vectors were dropped. */
  private prepare(embedder: Embedder): boolean {
    const dims = this.meta("dimensions");
    const same =
      this.modelId === embedder.id &&
      dims === String(embedder.dimensions) &&
      this.index.get("SELECT 1 FROM sqlite_master WHERE name = 'sem_vec'") !== undefined;
    if (same) return false;
    const had = this.count() > 0;
    this.index.db.transaction(() => {
      this.clear();
      this.index.db.exec(
        `CREATE VIRTUAL TABLE sem_vec USING vec0(embedding float[${Math.trunc(embedder.dimensions)}] distance_metric=cosine)`,
      );
      this.setMeta("model", embedder.id);
      this.setMeta("dimensions", String(embedder.dimensions));
    })();
    this.modelId = embedder.id;
    return had;
  }

  /**
   * Brings the vectors in line with the index: chunks that vanished lose their vector, new and
   * changed chunks are embedded, unchanged ones cost nothing. Safe to call at any time; it only
   * holds a database transaction while writing a batch, never while the model runs.
   */
  async sync(embedder: Embedder, opts: SyncOptions = {}): Promise<SyncReport> {
    if (!this.available) {
      return { chunks: 0, embedded: 0, removed: 0, rebuilt: false };
    }
    const rebuilt = this.prepare(embedder);
    const wanted = collectChunks(this.index, embedder.id);
    const stored = new Map<string, ChunkRow>();
    for (const r of this.index.all<ChunkRow>(
      "SELECT id, path, kind, ref, seq, hash FROM sem_chunks",
    )) {
      stored.set(key(r), r);
    }

    const wantedKeys = new Set(wanted.map(key));
    const stale = [...stored.values()].filter((r) => !wantedKeys.has(key(r)));
    const todo = wanted.filter((c) => stored.get(key(c))?.hash !== c.hash);

    if (stale.length > 0) {
      this.index.db.transaction(() => {
        for (const r of stale) this.deleteChunk(r.id);
      })();
    }

    const batchSize = opts.batchSize ?? 16;
    let done = 0;
    opts.onProgress?.(0, todo.length);
    for (let i = 0; i < todo.length; i += batchSize) {
      opts.signal?.throwIfAborted();
      const batch = todo.slice(i, i + batchSize);
      const vectors = await embedder.embedDocuments(
        batch.map((c) => c.input),
        opts.signal ? { signal: opts.signal } : {},
      );
      if (vectors.length !== batch.length) {
        throw new Error(
          `the embedder returned ${vectors.length} vectors for ${batch.length} texts`,
        );
      }
      this.index.db.transaction(() => {
        for (const [j, chunk] of batch.entries()) {
          const vec = vectors[j] as Float32Array;
          if (vec.length !== embedder.dimensions) {
            throw new Error(`expected ${embedder.dimensions} dimensions, got ${vec.length}`);
          }
          const old = stored.get(key(chunk));
          if (old) this.deleteChunk(old.id);
          this.insertChunk(chunk, vec);
        }
      })();
      done += batch.length;
      opts.onProgress?.(done, todo.length);
    }
    return { chunks: wanted.length, embedded: todo.length, removed: stale.length, rebuilt };
  }

  private deleteChunk(id: number): void {
    this.index.db.prepare("DELETE FROM sem_vec WHERE rowid = ?").run(BigInt(id));
    this.index.db.prepare("DELETE FROM sem_chunks WHERE id = ?").run(id);
  }

  private insertChunk(c: Chunk, vec: Float32Array): void {
    const info = this.index.db
      .prepare(
        "INSERT INTO sem_chunks(path, kind, ref, citekey, seq, hash, text) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(c.path, c.kind, c.ref, c.citekey, c.seq, c.hash, c.text);
    this.index.db
      .prepare("INSERT INTO sem_vec(rowid, embedding) VALUES (?, ?)")
      .run(BigInt(info.lastInsertRowid), Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength));
  }

  /**
   * The chunks closest to a query vector that satisfy the filter. Only chunks whose document is
   * still in the index count, so a deleted file never shows up while its vector awaits cleanup.
   */
  nearest(query: Float32Array, filter: VectorFilter, k: number): VectorHit[] {
    if (!this.available || filter.kinds.length === 0 || this.count() === 0) return [];
    const scope = scopeClauses(filter, {
      ownerKind: "(CASE WHEN c.kind = 'block' THEN 'item' ELSE c.kind END)",
      ownerRef: "(CASE WHEN c.kind = 'block' THEN c.citekey ELSE c.ref END)",
      citekey: "c.citekey",
    });
    const rows = this.index.all<{
      kind: string;
      ref: string;
      path: string;
      citekey: string | null;
      seq: number;
      text: string;
      distance: number;
    }>(
      `SELECT c.kind, c.ref, c.path, c.citekey, c.seq, c.text, v.distance
       FROM sem_vec v JOIN sem_chunks c ON c.id = v.rowid
       WHERE v.embedding MATCH ? AND k = ?
         AND v.rowid IN (
           SELECT c.id FROM sem_chunks c
           WHERE c.kind IN (${filter.kinds.map(() => "?").join(",")})
             AND EXISTS (SELECT 1 FROM docs d WHERE d.path = c.path AND d.kind = c.kind AND d.ref = c.ref)
             ${scope.sql.map((s) => `AND ${s}`).join(" ")}
         )
       ORDER BY v.distance`,
      Buffer.from(query.buffer, query.byteOffset, query.byteLength),
      k,
      ...filter.kinds,
      ...scope.params,
    );
    return rows.map((r) => ({
      kind: r.kind,
      ref: r.ref,
      path: r.path,
      citekey: r.citekey,
      seq: r.seq,
      text: r.text,
      similarity: 1 - r.distance,
    }));
  }
}
