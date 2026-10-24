import { join } from "node:path";
import type { DownloadProgress, EmbedOptions } from "./types.js";

/**
 * Cross-encoder rerankers citegeist can run locally. A cross-encoder reads query and passage
 * together and scores how well the passage answers the query, which is slower but sharper than
 * comparing two vectors. All ship as quantized ONNX weights that Transformers.js reads. The
 * revision pins the exact commit, so a reranker never changes under the user.
 */
export interface RerankerSpec {
  key: string;
  /** Hugging Face repository with the ONNX weights. */
  repo: string;
  /** Commit hash. Never a branch name. */
  revision: string;
  /** Quantization: "q8" loads onnx/model_quantized.onnx. */
  dtype: "q8";
  /** License of the model weights as given by the original authors. */
  license: string;
  /** Token limit for query and passage together; longer pairs are truncated. */
  maxTokens: number;
}

export const MXBAI_RERANK_XSMALL: RerankerSpec = {
  key: "mxbai-rerank-xsmall-v1",
  repo: "mixedbread-ai/mxbai-rerank-xsmall-v1",
  revision: "b5c6e9da73abc3711f593f705371cdbe9e0fe422",
  dtype: "q8",
  license: "Apache-2.0",
  maxTokens: 512,
};

export const BGE_RERANKER_BASE: RerankerSpec = {
  key: "bge-reranker-base",
  repo: "Xenova/bge-reranker-base",
  revision: "280bcc27a84e0b898c251e06fddb25171bd9b101",
  dtype: "q8",
  license: "MIT",
  maxTokens: 512,
};

export const BGE_RERANKER_V2_M3: RerankerSpec = {
  key: "bge-reranker-v2-m3",
  repo: "onnx-community/bge-reranker-v2-m3-ONNX",
  revision: "6f5ff65298512715a1e669753bc754d2bc8f367b",
  dtype: "q8",
  license: "Apache-2.0",
  maxTokens: 512,
};

export const RERANKERS: Record<string, RerankerSpec> & { default: RerankerSpec } = {
  [MXBAI_RERANK_XSMALL.key]: MXBAI_RERANK_XSMALL,
  [BGE_RERANKER_BASE.key]: BGE_RERANKER_BASE,
  [BGE_RERANKER_V2_M3.key]: BGE_RERANKER_V2_M3,
  default: MXBAI_RERANK_XSMALL,
};

/** The reranker used when the setting is on and no other one is chosen. */
export const DEFAULT_RERANKER: RerankerSpec = RERANKERS.default;

/** Scores passages against a query. Higher is better; the scale is only good for ordering. */
export interface Reranker {
  readonly id: string;
  rerank(query: string, passages: string[], options?: EmbedOptions): Promise<number[]>;
  close?(): Promise<void>;
}

export interface TransformersRerankerOptions {
  model?: RerankerSpec;
  /** Machine-local directory for the model files, the same as for the embedder. */
  modelsDir: string;
  /** Pairs per forward pass. Default 16. */
  batchSize?: number;
  /** Fail instead of downloading when the files are not in `modelsDir`. */
  localFilesOnly?: boolean;
  onDownload?: (progress: DownloadProgress) => void;
}

type PairTokenizer = (
  queries: string[],
  options: { text_pair: string[]; padding: boolean; truncation: boolean; max_length: number },
) => Record<string, unknown>;
interface Logits {
  dims: number[];
  data: ArrayLike<number | bigint>;
}
type ClassifierModel = (inputs: Record<string, unknown>) => Promise<{ logits: Logits }>;

interface Loaded {
  tokenizer: PairTokenizer;
  model: ClassifierModel;
  dispose?: () => Promise<void>;
}

/**
 * Runs an ONNX cross-encoder with Transformers.js in the current process. Like the embedder it
 * loads on first use and serializes its calls.
 */
export class TransformersReranker implements Reranker {
  readonly id: string;
  readonly model: RerankerSpec;
  private readonly opts: TransformersRerankerOptions;
  private loading: Promise<Loaded> | undefined;
  private tail: Promise<unknown> = Promise.resolve();

  constructor(opts: TransformersRerankerOptions) {
    this.opts = opts;
    this.model = opts.model ?? DEFAULT_RERANKER;
    this.id = `${this.model.key}@${this.model.revision.slice(0, 8)}:${this.model.dtype}`;
  }

  async rerank(query: string, passages: string[], options?: EmbedOptions): Promise<number[]> {
    const out: number[] = [];
    const size = this.opts.batchSize ?? 16;
    for (let i = 0; i < passages.length; i += size) {
      out.push(...(await this.run(query, passages.slice(i, i + size), options?.signal)));
    }
    return out;
  }

  async warmup(): Promise<void> {
    await this.load();
  }

  async close(): Promise<void> {
    const loading = this.loading;
    this.loading = undefined;
    if (loading) await (await loading).dispose?.();
  }

  private run(
    query: string,
    passages: string[],
    signal: AbortSignal | undefined,
  ): Promise<number[]> {
    const next = this.tail.then(async () => {
      signal?.throwIfAborted();
      const { tokenizer, model } = await this.load();
      signal?.throwIfAborted();
      const inputs = tokenizer(
        passages.map(() => query),
        {
          text_pair: passages,
          padding: true,
          truncation: true,
          max_length: this.model.maxTokens,
        },
      );
      const { logits } = await model(inputs);
      // One logit per pair; a two-class head scores by the "relevant" logit (the last one).
      const width = logits.dims[1] ?? 1;
      return passages.map((_, i) => Number(logits.data[i * width + (width - 1)] ?? 0));
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
    )) as unknown as PairTokenizer;
    const model = await tf.AutoModelForSequenceClassification.from_pretrained(this.model.repo, {
      ...common,
      dtype: this.model.dtype,
      device: "cpu",
    });
    const call = model as unknown as ClassifierModel;
    return {
      tokenizer,
      model: (inputs) => call(inputs),
      dispose: async () => {
        await (model as unknown as { dispose?: () => Promise<void> }).dispose?.();
      },
    };
  }
}

/** A deterministic stand-in for tests: scores by the share of query words in the passage. */
export class FakeReranker implements Reranker {
  readonly id = "fake-reranker@1";
  calls = 0;
  async rerank(query: string, passages: string[]): Promise<number[]> {
    this.calls++;
    const words = query.toLowerCase().split(/\W+/).filter(Boolean);
    return passages.map((p) => {
      const text = p.toLowerCase();
      return words.length === 0 ? 0 : words.filter((w) => text.includes(w)).length / words.length;
    });
  }
}
