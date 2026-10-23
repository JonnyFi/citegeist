import { type Embedder, type EmbedOptions, l2normalize } from "./types.js";

export interface FakeEmbedderOptions {
  /** Vector size. Default 64. */
  dimensions?: number;
  /**
   * Words that mean the same thing. Every word on the left is embedded as the word on the right,
   * so a test can make "automobil" find a text about "wagen" without any shared token.
   */
  synonyms?: Record<string, string>;
  /** Appended to the id; change it to simulate a model switch. Default "1". */
  version?: string;
}

/** FNV-1a, 32 bit. */
function fnv(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * A deterministic stand-in for a model: words and character trigrams hash into buckets, so
 * texts that share vocabulary land close together. It needs no download and no native code.
 * `calls` and `texts` let tests assert how much work was done.
 */
export class FakeEmbedder implements Embedder {
  readonly id: string;
  readonly dimensions: number;
  private readonly synonyms: Map<string, string>;
  /** Number of embedDocuments and embedQuery calls so far. */
  calls = 0;
  /** Every text embedded so far, in order. */
  readonly texts: string[] = [];

  constructor(opts: FakeEmbedderOptions = {}) {
    this.dimensions = opts.dimensions ?? 64;
    this.synonyms = new Map(Object.entries(opts.synonyms ?? {}));
    this.id = `fake-hash-v${opts.version ?? "1"}:${this.dimensions}`;
  }

  async embedDocuments(texts: string[], options?: EmbedOptions): Promise<Float32Array[]> {
    options?.signal?.throwIfAborted();
    this.calls++;
    this.texts.push(...texts);
    return texts.map((t) => this.vector(t));
  }

  async embedQuery(text: string, options?: EmbedOptions): Promise<Float32Array> {
    options?.signal?.throwIfAborted();
    this.calls++;
    this.texts.push(text);
    return this.vector(text);
  }

  private vector(text: string): Float32Array {
    const v = new Float32Array(this.dimensions);
    const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
    for (const raw of words) {
      const w = this.synonyms.get(raw) ?? raw;
      const bump = (key: string, weight: number): void => {
        const h = fnv(key);
        const at = h % this.dimensions;
        v[at] = (v[at] ?? 0) + (h & 0x100 ? weight : -weight);
      };
      bump(`w:${w}`, 1);
      if (w.length >= 3) {
        const padded = `^${w}$`;
        for (let i = 0; i + 3 <= padded.length; i++) bump(`t:${padded.slice(i, i + 3)}`, 0.25);
      }
    }
    return l2normalize(v);
  }
}

export function createFakeEmbedder(opts: FakeEmbedderOptions = {}): FakeEmbedder {
  return new FakeEmbedder(opts);
}
