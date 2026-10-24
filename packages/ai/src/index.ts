export const name = "@citegeist/ai";

export {
  ClaudeCodeCliBackend,
  type ClaudeCodeCliOptions,
  claudeUsage,
  PINNED_CLAUDE_VERSION,
} from "./backends/claude-cli.js";
export { CodexExecBackend, type CodexExecOptions, codexUsage } from "./backends/codex-exec.js";
export {
  CursorCliBackend,
  type CursorCliOptions,
  cursorUsage,
  PINNED_CURSOR_VERSION,
} from "./backends/cursor-cli.js";
export { MockBackend, type MockResponse } from "./backends/mock.js";
export {
  chatCompletionUsage,
  OPENAI_COMPAT_PRESETS,
  OpenAiCompatBackend,
  type OpenAiCompatOptions,
} from "./backends/openai-http.js";
export { aiErrors } from "./errors.js";
export {
  AiRouter,
  type AiRoutingSettings,
  resolveBackendId,
  resolveLanguage,
} from "./routing.js";
export { nodeRunner, type ProcessRunner, type RunResult, type RunSpec } from "./runner.js";
export { parseJsonLoose, structured, toModelJsonSchema } from "./structured.js";
export {
  CardParaphraseInput,
  CardParaphraseOutput,
} from "./tasks/card-paraphrase/index.js";
export { CardVerifyInput, CardVerifyOutput } from "./tasks/card-verify/index.js";
export {
  ConceptDescribeInput,
  ConceptDescribeOutput,
  ConceptPassage,
  MAX_USAGE_EVIDENCE,
  sanitizeUsage,
  type VerifiedUsage,
} from "./tasks/concept-describe/index.js";
export { ConceptNameInput, ConceptNameOutput } from "./tasks/concept-name/index.js";
export {
  LitsearchSuggestQueriesInput,
  LitsearchSuggestQueriesOutput,
  planSuggestedQueries,
  queryKey,
} from "./tasks/litsearch-suggest-queries/index.js";
export {
  MAX_EVIDENCE,
  MatrixFillCellInput,
  MatrixFillCellOutput,
  MatrixPassage,
  MIN_QUOTE_CHARS,
  noInfoText,
  normalizeForMatch,
  type QuoteMatch,
  type SanitizedCell,
  sanitizeCell,
  type VerifiedEvidence,
  verifyQuote,
} from "./tasks/matrix-fill-cell/index.js";
export {
  MetadataFromFirstPageInput,
  MetadataFromFirstPageOutput,
} from "./tasks/metadata-from-first-page/index.js";
export {
  type LinkProposal,
  MAX_PROPOSALS,
  NoteProposeLinksInput,
  NoteProposeLinksOutput,
  sanitizeProposals,
} from "./tasks/note-propose-links/index.js";
export {
  getTask,
  type RunTaskOptions,
  runTask,
  TASK_NAMES,
  TASKS,
  type TaskInput,
  type TaskName,
  type TaskOutput,
  type TaskResult,
  type UsageRecord,
} from "./tasks/registry.js";
export type { EvalFixture, TaskDefinition } from "./tasks/types.js";
export type {
  AgentEvent,
  AgentSession,
  AiUsage,
  CompleteRequest,
  InferenceBackend,
  McpConfig,
  ModelChoice,
  ModelClass,
  SessionRequest,
} from "./types.js";
