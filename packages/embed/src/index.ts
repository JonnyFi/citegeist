export const name = "@citegeist/embed";

export { createFakeEmbedder, FakeEmbedder, type FakeEmbedderOptions } from "./fake.js";
export {
  DEFAULT_MODEL,
  EMBEDDING_GEMMA_300M,
  MODELS,
  type ModelSpec,
  QWEN3_EMBEDDING_0_6B,
} from "./models.js";
export {
  createTransformersEmbedder,
  TransformersEmbedder,
  type TransformersEmbedderOptions,
} from "./transformers.js";
export {
  type DownloadProgress,
  dot,
  type Embedder,
  type EmbedOptions,
  l2normalize,
} from "./types.js";
