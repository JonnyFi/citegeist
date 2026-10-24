import {
  DEFAULT_MODEL,
  DEFAULT_RERANKER,
  type DownloadProgress,
  type Embedder,
  MODELS,
  type ModelSpec,
  type Reranker,
  TransformersEmbedder,
  TransformersReranker,
} from "@citegeist/embed";
import type { JobQueue } from "../jobs/index.js";
import type { Library } from "../library.js";
import type { SearchHit, SearchInput } from "../search.js";
import { type AttachedSemantic, type AttachSemanticOptions, attachSemantic } from "./attach.js";

/** An embedder that can fetch and load its model ahead of the first text (TransformersEmbedder). */
export interface ModelEmbedder extends Embedder {
  warmup?(): Promise<void>;
}

/** A reranker that can fetch and load its model ahead of the first search. */
export interface ModelReranker extends Reranker {
  warmup?(): Promise<void>;
}

export type SemanticState = "off" | "downloading" | "ready" | "error";

export interface SemanticStatus {
  state: SemanticState;
  /** Key of the model, e.g. "embeddinggemma-300m". */
  model: string;
  /** 0 to 1 while the model files download. */
  progress?: number;
  /** The reason when `state` is "error". */
  detail?: string;
  /** Reranker, present while the setting is on and search is ready. */
  rerank?: "loading" | "ready" | "error";
  rerankDetail?: string;
}

export interface SemanticControllerOptions {
  lib: Library;
  queue: JobQueue;
  /**
   * An embedder to use as is. Semantic search is then always on and the switch does nothing.
   * Tests pass a fake one.
   */
  embedder?: ModelEmbedder | undefined;
  /** Builds the embedder that the switch turns on. Default: the Transformers.js one. */
  createEmbedder?:
    | ((onDownload: (p: DownloadProgress) => void, model: ModelSpec) => ModelEmbedder)
    | undefined;
  /** Builds the reranker that `rerank` turns on. Default: the Transformers.js one. */
  createReranker?: (() => ModelReranker) | undefined;
  /** Passed on to attachSemantic (debounce, similarity floor, weights). */
  semantic?: Omit<AttachSemanticOptions, "embedder"> | undefined;
}

/**
 * Owns the life cycle of semantic search for one library. It starts off. `setEnabled(true)`
 * downloads and loads the model (progress in `status()`), and only when that has worked it
 * attaches the embed job and the hybrid search. Until then `search()` is plain full-text search,
 * so turning the feature on never changes results before the model is there, and a failed
 * download leaves search as it was.
 */
export class SemanticController {
  private state: SemanticState = "off";
  private detail: string | undefined;
  private embedder: ModelEmbedder | undefined;
  private attached: AttachedSemantic | undefined;
  private readonly files = new Map<string, { loaded: number; total: number }>();
  private readonly fixed: boolean;
  private starting: Promise<void> | undefined;
  /** Key of the model the settings ask for. */
  private wanted: string = DEFAULT_MODEL.key;
  private wantRerank = false;
  private reranker: ModelReranker | undefined;
  private rerankState: "loading" | "ready" | "error" | undefined;
  private rerankDetail: string | undefined;

  constructor(private readonly opts: SemanticControllerOptions) {
    this.fixed = opts.embedder !== undefined;
    if (opts.embedder) this.attach(opts.embedder);
  }

  status(): SemanticStatus {
    const status: SemanticStatus = {
      state: this.state,
      model: this.embedder?.id.split("@")[0] ?? this.wanted,
    };
    if (this.state === "downloading") status.progress = this.progress();
    if (this.detail) status.detail = this.detail;
    if (this.attached && this.rerankState) {
      status.rerank = this.rerankState;
      if (this.rerankDetail) status.rerankDetail = this.rerankDetail;
    }
    return status;
  }

  /**
   * Cosine similarity of each text to the query, or undefined when no model is ready. Used by the
   * planning tools to rank insights after their link stage.
   */
  async rank(query: string, texts: string[]): Promise<number[] | undefined> {
    const e = this.state === "ready" ? this.embedder : undefined;
    if (!e || texts.length === 0) return undefined;
    const [q, docs] = await Promise.all([e.embedQuery(query), e.embedDocuments(texts)]);
    const norm = (v: Float32Array) => Math.sqrt(v.reduce((a, x) => a + x * x, 0)) || 1;
    const nq = norm(q);
    return docs.map((d) => {
      let dot = 0;
      for (let i = 0; i < d.length; i++) dot += (d[i] ?? 0) * (q[i] ?? 0);
      return dot / (norm(d) * nq);
    });
  }

  /** Hybrid search when the model is ready, full-text search otherwise. */
  async search(input: SearchInput, signal?: AbortSignal): Promise<SearchHit[]> {
    if (this.attached) return this.attached.semantic.search(input, signal);
    return this.opts.lib.search(input);
  }

  /**
   * Follows the settings: the switch and the model. A different model while the search runs
   * replaces the embedder; the store sees the new model id and re-embeds from scratch.
   */
  configure(enabled: boolean, model?: string, rerank = false): Promise<void> {
    const key = model && MODELS[model] ? model : DEFAULT_MODEL.key;
    const changed = key !== this.wanted;
    this.wanted = key;
    this.wantRerank = rerank;
    if (changed && !this.fixed && this.state !== "off") this.stop();
    const started = this.setEnabled(enabled);
    this.syncReranker();
    return started;
  }

  /** Follows the setting. Returns when the model is ready or the attempt has failed. */
  setEnabled(enabled: boolean): Promise<void> {
    if (this.fixed) return Promise.resolve();
    if (!enabled) {
      this.stop();
      return Promise.resolve();
    }
    if (this.state === "downloading" || this.state === "ready") {
      return this.starting ?? Promise.resolve();
    }
    this.starting = this.start().finally(() => {
      this.starting = undefined;
    });
    return this.starting;
  }

  close(): void {
    this.stop();
  }

  private async start(): Promise<void> {
    this.state = "downloading";
    this.detail = undefined;
    this.files.clear();
    const spec = MODELS[this.wanted] ?? DEFAULT_MODEL;
    const embedder = (this.opts.createEmbedder ?? defaultEmbedder(this.opts.lib))(
      (p) => this.onDownload(p),
      spec,
    );
    this.embedder = embedder;
    try {
      await embedder.warmup?.();
    } catch (err) {
      if (this.embedder === embedder) {
        this.embedder = undefined;
        this.state = "error";
        this.detail = err instanceof Error ? err.message : String(err);
      }
      await embedder.close?.().catch(() => {});
      return;
    }
    // Switched off while the files were coming in: nothing to attach.
    if (this.embedder !== embedder) {
      await embedder.close?.().catch(() => {});
      return;
    }
    this.attach(embedder);
  }

  private attach(embedder: ModelEmbedder): void {
    this.embedder = embedder;
    this.attached = attachSemantic(this.opts.lib, this.opts.queue, {
      ...this.opts.semantic,
      embedder,
    });
    this.state = "ready";
    this.detail = undefined;
    this.syncReranker();
  }

  /**
   * Makes the reranker match the setting. It is downloaded and loaded in the background and only
   * joins the search once it is ready, so turning it on never blocks or changes a search early.
   */
  private syncReranker(): void {
    const semantic = this.attached?.semantic;
    if (!semantic || !this.wantRerank) {
      this.dropReranker();
      return;
    }
    if (this.reranker) return;
    const reranker =
      this.opts.createReranker?.() ??
      new TransformersReranker({
        model: DEFAULT_RERANKER,
        modelsDir: this.opts.lib.local.modelsDir,
      });
    this.reranker = reranker;
    this.rerankState = "loading";
    this.rerankDetail = undefined;
    void (async () => {
      try {
        await reranker.warmup?.();
        if (this.reranker !== reranker) return;
        semantic.setReranker(reranker);
        this.rerankState = "ready";
      } catch (err) {
        if (this.reranker !== reranker) return;
        this.reranker = undefined;
        this.rerankState = "error";
        this.rerankDetail = err instanceof Error ? err.message : String(err);
        await reranker.close?.().catch(() => {});
      }
    })();
  }

  private dropReranker(): void {
    const reranker = this.reranker;
    this.attached?.semantic.setReranker(undefined);
    this.reranker = undefined;
    this.rerankState = undefined;
    this.rerankDetail = undefined;
    void reranker?.close?.().catch(() => {});
  }

  private stop(): void {
    this.dropReranker();
    if (this.fixed) {
      this.attached?.detach();
      this.attached = undefined;
      return;
    }
    const embedder = this.embedder;
    this.attached?.detach();
    this.attached = undefined;
    this.embedder = undefined;
    this.state = "off";
    this.detail = undefined;
    void embedder?.close?.().catch(() => {});
  }

  private onDownload(p: DownloadProgress): void {
    this.files.set(p.file, { loaded: p.loadedBytes, total: p.totalBytes });
  }

  private progress(): number {
    let loaded = 0;
    let total = 0;
    for (const f of this.files.values()) {
      loaded += f.loaded;
      total += f.total;
    }
    return total === 0 ? 0 : Math.min(1, loaded / total);
  }
}

function defaultEmbedder(
  lib: Library,
): (onDownload: (p: DownloadProgress) => void, model: ModelSpec) => ModelEmbedder {
  // Nothing is fetched or loaded until warmup() runs.
  return (onDownload, model) =>
    new TransformersEmbedder({ modelsDir: lib.local.modelsDir, model, onDownload });
}
