export const name = "@citegeist/ai";

export {
  ClaudeCodeCliBackend,
  type ClaudeCodeCliOptions,
  PINNED_CLAUDE_VERSION,
} from "./backends/claude-cli.js";
export { CodexExecBackend, type CodexExecOptions } from "./backends/codex-exec.js";
export { MockBackend, type MockResponse } from "./backends/mock.js";
export {
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
  MetadataFromFirstPageInput,
  MetadataFromFirstPageOutput,
} from "./tasks/metadata-from-first-page/index.js";
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
} from "./tasks/registry.js";
export type { EvalFixture, TaskDefinition } from "./tasks/types.js";
export type {
  AgentEvent,
  AgentSession,
  CompleteRequest,
  InferenceBackend,
  McpConfig,
  ModelChoice,
  ModelClass,
  SessionRequest,
} from "./types.js";
