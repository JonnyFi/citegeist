import type { Embedder } from "@citegeist/embed";
import type { JobQueue } from "../jobs/index.js";
import type { Library } from "../library.js";
import { type SemanticOptions, SemanticSearch } from "./hybrid.js";
import { EmbedScheduler, type EmbedSchedulerOptions, registerEmbedJob } from "./jobs.js";

export { type Chunk, collectChunks, splitBody } from "./chunks.js";
export { type RankedList, RRF_K, reciprocalRankFusion } from "./fusion.js";
export { type SemanticOptions, SemanticSearch } from "./hybrid.js";
export { EmbedScheduler, type EmbedSchedulerOptions, registerEmbedJob } from "./jobs.js";
export {
  SemanticStore,
  type SyncOptions,
  type SyncReport,
  type VectorFilter,
  type VectorHit,
} from "./store.js";

export interface AttachSemanticOptions extends SemanticOptions, EmbedSchedulerOptions {
  embedder: Embedder;
}

export interface AttachedSemantic {
  /** Use `semantic.search(input)` in place of `lib.search(input)` for hybrid results. */
  semantic: SemanticSearch;
  scheduler: EmbedScheduler;
  /** Stops listening and cancels the pending debounce. Does not touch queued jobs. */
  detach(): void;
}

/**
 * Wires semantic search into a running library: registers the "embed" job kind on the queue,
 * queues a job after every indexing change (and once now, to catch up after a start), and
 * returns the hybrid search to bind to `search.query`.
 */
export function attachSemantic(
  lib: Library,
  queue: JobQueue,
  opts: AttachSemanticOptions,
): AttachedSemantic {
  const { embedder, debounceMs, ...searchOpts } = opts;
  const semantic = new SemanticSearch(lib.index, embedder, searchOpts);
  registerEmbedJob(queue, semantic);
  const scheduler = new EmbedScheduler(queue, debounceMs === undefined ? {} : { debounceMs });
  const onChange = (e: { status: string }): void => {
    if (e.status === "indexed" || e.status === "removed") scheduler.notify();
  };
  lib.on("change", onChange);
  scheduler.notify();
  return {
    semantic,
    scheduler,
    detach() {
      lib.off("change", onChange);
      scheduler.close();
    },
  };
}
