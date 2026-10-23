/**
 * The embedding models citegeist can run locally. Both ship as quantized ONNX weights in an
 * onnx-community repository that Transformers.js reads. The revision pins the exact commit, so a
 * model never changes under an existing index.
 */
export interface ModelSpec {
  key: string;
  /** Hugging Face repository with the ONNX weights. */
  repo: string;
  /** Commit hash. Never a branch name. */
  revision: string;
  /** Quantization: "q8" loads onnx/model_quantized.onnx. */
  dtype: "q8";
  license: string;
  /** Size of the vectors the model produces. */
  nativeDimensions: number;
  /** Size actually stored. Matryoshka models can be cut down and re-normalized. */
  dimensions: number;
  /** How a text becomes one vector. */
  pooling: "last-token" | "sentence-embedding";
  /** Token limit per text; longer texts are truncated. */
  maxTokens: number;
  queryPrefix: string;
  documentPrefix: string;
}

const RETRIEVAL_INSTRUCTION =
  "Given a search query, retrieve relevant passages from academic papers, notes and quotes in German or English";

export const QWEN3_EMBEDDING_0_6B: ModelSpec = {
  key: "qwen3-embedding-0.6b",
  repo: "onnx-community/Qwen3-Embedding-0.6B-ONNX",
  revision: "c25a394dd583836952667c12f008335071b3f43d",
  dtype: "q8",
  license: "Apache-2.0",
  nativeDimensions: 1024,
  dimensions: 512,
  pooling: "last-token",
  maxTokens: 512,
  queryPrefix: `Instruct: ${RETRIEVAL_INSTRUCTION}\nQuery:`,
  documentPrefix: "",
};

export const EMBEDDING_GEMMA_300M: ModelSpec = {
  key: "embeddinggemma-300m",
  repo: "onnx-community/embeddinggemma-300m-ONNX",
  revision: "5090578d9565bb06545b4552f76e6bc2c93e4a66",
  dtype: "q8",
  license: "Gemma Terms of Use",
  nativeDimensions: 768,
  dimensions: 512,
  pooling: "sentence-embedding",
  maxTokens: 512,
  queryPrefix: "task: search result | query: ",
  documentPrefix: "title: none | text: ",
};

export const MODELS: Record<string, ModelSpec> = {
  [QWEN3_EMBEDDING_0_6B.key]: QWEN3_EMBEDDING_0_6B,
  [EMBEDDING_GEMMA_300M.key]: EMBEDDING_GEMMA_300M,
};

/** The model the app uses unless the settings say otherwise. Chosen by the check in packages/embed/RETRIEVAL.md. */
export const DEFAULT_MODEL: ModelSpec = EMBEDDING_GEMMA_300M;
