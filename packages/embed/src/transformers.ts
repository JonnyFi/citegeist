import { join } from "node:path";
import { DEFAULT_MODEL, type ModelSpec } from "./models.js";
import { type DownloadProgress, type Embedder, type EmbedOptions, l2normalize } from "./types.js";

export interface TransformersEmbedderOptions {
  /** Default: Qwen3-Embedding-0.6B. */
  model?: ModelSpec;
  /**
   * Machine-local directory for the model files (`LocalPaths.modelsDir`). Files are downloaded
   * into it the first time the model is used. Never inside the synced library folder.
   */
  modelsDir: string;
  /** Texts per forward pass. Default 8. */
  batchSize?: number;
  /** "cpu" by default; "coreml" and "webgpu" are worth trying on a Mac. */
  device?: "cpu" | "coreml" | "webgpu";
  /** Fail instead of downloading when the files are not in `modelsDir`. */
  localFilesOnly?: boolean;
  onDownload?: (progress: DownloadProgress) => void;
}

// The parts of Transformers.js used here. Typed by hand so this file does not depend on its
// (large) type surface and so the module can be imported lazily.
type TokenizerLike = (
  texts: string[],
  options: { padding: boolean; truncation: boolean; max_length: number },
) => Record<string, unknown> & { attention_mask: TensorLike };
export interface TensorLike {
  dims: number[];
  data: ArrayLike<number | bigint>;
}
type ModelLike = (inputs: Record<string, unknown>) => Promise<Record<string, TensorLike>>;

interface Loaded {
  tokenizer: TokenizerLike;
  model: ModelLike;
  dispose?: () => Promise<void>;
}

/**
 * Runs an ONNX embedding model with Transformers.js in the current process. The model loads on
 * the first call, never at construction. Calls are serialized, because one session cannot run
 * two batches at once.
 */
export class TransformersEmbedder implements Embedder {
  readonly id: string;
  readonly dimensions: number;
  readonly model: ModelSpec;
  private readonly opts: TransformersEmbedderOptions;
  private loading: Promise<Loaded> | undefined;
  private tail: Promise<unknown> = Promise.resolve();

  constructor(opts: TransformersEmbedderOptions) {
    this.opts = opts;
    this.model = opts.model ?? DEFAULT_MODEL;
    this.dimensions = this.model.dimensions;
    this.id = `${this.model.key}@${this.model.revision.slice(0, 8)}:${this.model.dtype}:${this.dimensions}`;
  }

  async embedDocuments(texts: string[], options?: EmbedOptions): Promise<Float32Array[]> {
    const prefixed = texts.map((t) => this.model.documentPrefix + t);
    const out: Float32Array[] = [];
    const size = this.opts.batchSize ?? 8;
    for (let i = 0; i < prefixed.length; i += size) {
      out.push(...(await this.run(prefixed.slice(i, i + size), options?.signal)));
    }
    return out;
  }

  async embedQuery(text: string, options?: EmbedOptions): Promise<Float32Array> {
    const [v] = await this.run([this.model.queryPrefix + text], options?.signal);
    if (!v) throw new Error("the model returned no vector");
    return v;
  }

  async close(): Promise<void> {
    const loading = this.loading;
    this.loading = undefined;
    if (loading) await (await loading).dispose?.();
  }

  /** Makes sure the model files are on disk and loads them. Useful to show a download early. */
  async warmup(): Promise<void> {
    await this.load();
  }

  private run(texts: string[], signal: AbortSignal | undefined): Promise<Float32Array[]> {
    const next = this.tail.then(async () => {
      signal?.throwIfAborted();
      const { tokenizer, model } = await this.load();
      signal?.throwIfAborted();
      const inputs = tokenizer(texts, {
        padding: true,
        truncation: true,
        max_length: this.model.maxTokens,
      });
      const outputs = await model(inputs);
      return poolEmbeddings(this.model, outputs, inputs.attention_mask, texts.length);
    });
    this.tail = next.catch(() => undefined);
    return next;
  }

  private load(): Promise<Loaded> {
    this.loading ??= this.loadModel().catch((err) => {
      this.loading = undefined;
      throw err;
    });
    return this.loading;
  }

  private async loadModel(): Promise<Loaded> {
    const tf = await import("@huggingface/transformers");
    const common = {
      revision: this.model.revision,
      cache_dir: join(this.opts.modelsDir, "transformers"),
      local_files_only: this.opts.localFilesOnly ?? false,
      progress_callback: (p: {
        status?: string;
        file?: string;
        progress?: number;
        loaded?: number;
        total?: number;
      }) => {
        if (p.status !== "progress" || !p.file) return;
        this.opts.onDownload?.({
          file: p.file,
          progress: (p.progress ?? 0) / 100,
          loadedBytes: p.loaded ?? 0,
          totalBytes: p.total ?? 0,
        });
      },
    };
    const tokenizer = (await tf.AutoTokenizer.from_pretrained(
      this.model.repo,
      common,
    )) as unknown as TokenizerLike;
    // Without the vision and audio configs Transformers.js neither downloads nor loads the
    // encoders of a multimodal repository.
    let config: unknown;
    if (this.model.textOnly) {
      const c = (await tf.AutoConfig.from_pretrained(this.model.repo, common)) as unknown as Record<
        string,
        unknown
      >;
      c.vision_config = null;
      c.audio_config = null;
      config = c;
    }
    const model = await tf.AutoModel.from_pretrained(this.model.repo, {
      ...common,
      ...(config ? { config: config as never } : {}),
      dtype: this.model.dtype,
      device: this.opts.device ?? "cpu",
    });
    const call = model as unknown as ModelLike;
    return {
      tokenizer,
      model: (inputs) => call(inputs),
      dispose: async () => {
        await (model as unknown as { dispose?: () => Promise<void> }).dispose?.();
      },
    };
  }
}

export function createTransformersEmbedder(opts: TransformersEmbedderOptions): Embedder {
  return new TransformersEmbedder(opts);
}

/**
 * Turns model output into unit vectors of `spec.dimensions`: the last real token's hidden state
 * for decoder models (Qwen3), the model's own sentence embedding otherwise (EmbeddingGemma).
 * Matryoshka models are cut to the first `dimensions` values and normalized again.
 */
export function poolEmbeddings(
  spec: ModelSpec,
  outputs: Record<string, TensorLike>,
  mask: TensorLike,
  count: number,
): Float32Array[] {
  const out: Float32Array[] = [];
  const dims = spec.dimensions;
  if (spec.pooling === "sentence-embedding") {
    const t = outputs.sentence_embedding;
    if (!t) throw new Error("the model output has no sentence_embedding");
    const width = t.dims[1] ?? spec.nativeDimensions;
    for (let b = 0; b < count; b++) {
      const v = new Float32Array(dims);
      for (let d = 0; d < dims; d++) v[d] = Number(t.data[b * width + d] ?? 0);
      out.push(l2normalize(v));
    }
    return out;
  }
  const h = outputs.last_hidden_state;
  if (!h) throw new Error("the model output has no last_hidden_state");
  const seq = h.dims[1] ?? 0;
  const width = h.dims[2] ?? spec.nativeDimensions;
  for (let b = 0; b < count; b++) {
    // Last real token: the final position whose attention mask is 1 (works for either padding side).
    let last = 0;
    for (let t = 0; t < seq; t++) if (Number(mask.data[b * seq + t]) === 1) last = t;
    const v = new Float32Array(dims);
    const base = (b * seq + last) * width;
    for (let d = 0; d < dims; d++) v[d] = Number(h.data[base + d] ?? 0);
    out.push(l2normalize(v));
  }
  return out;
}
