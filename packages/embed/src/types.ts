/** Turns text into unit-length vectors. Queries and documents may be embedded differently. */
export interface Embedder {
  /**
   * Identifies the model, revision, quantization and vector size. Stored next to the vectors:
   * when it changes, the stored vectors are stale and get rebuilt.
   */
  readonly id: string;
  readonly dimensions: number;
  embedDocuments(texts: string[], options?: EmbedOptions): Promise<Float32Array[]>;
  embedQuery(text: string, options?: EmbedOptions): Promise<Float32Array>;
  /** Frees the model. The embedder may be used again afterwards (it loads the model again). */
  close?(): Promise<void>;
}

export interface EmbedOptions {
  signal?: AbortSignal;
}

/** Progress of the model files while they are downloaded the first time. */
export interface DownloadProgress {
  file: string;
  /** 0 to 1 */
  progress: number;
  loadedBytes: number;
  totalBytes: number;
}

export function l2normalize(v: Float32Array): Float32Array {
  let sum = 0;
  for (const x of v) sum += x * x;
  const norm = Math.sqrt(sum);
  if (norm === 0) return v;
  for (let i = 0; i < v.length; i++) v[i] = (v[i] ?? 0) / norm;
  return v;
}

/** Cosine similarity of two unit vectors. */
export function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] ?? 0) * (b[i] ?? 0);
  return s;
}
