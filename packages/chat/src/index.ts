export const name = "@citegeist/chat";

export { AcpConnection, AcpDriver, AcpPool } from "./acp.js";
export {
  adapterLaunch,
  agentEnv,
  type BackendDefinition,
  type BackendStatus,
  CLAUDE_ACP_PACKAGE,
  CLAUDE_CODE,
  CODEX,
  CODEX_ACP_PACKAGE,
  CURSOR,
  checkBackend,
  cliProblem,
  DEFAULT_BACKENDS,
  findExecutable,
  installedCli,
  type LoginCheck,
  resolveAdapterEntry,
} from "./backends.js";
export type { AgentDriver, DriverEvent, DriverFactory, DriverRequest } from "./driver.js";
export { createDrivers, type DriverFactoryOptions, type Drivers } from "./drivers.js";
export {
  diffSnapshots,
  type JournalEdit,
  type RevertResult,
  revertEdits,
  SnapshotCache,
} from "./journal.js";
export { merge3 } from "./merge.js";
export { bindChatOperations, type ChatOperationsDeps } from "./ops.js";
export {
  citegeistTool,
  decide,
  type PolicyContext,
  pickOption,
  type SessionMode,
} from "./policy.js";
export { ClaudePrintDriver, mcpConfigJson } from "./print-driver.js";
export {
  type JobQueuePort,
  type ResearchInput,
  type ResearchJobContext,
  type ResearchResult,
  registerResearch,
  runResearch,
} from "./research.js";
export { type ChatHost, ChatService, type ServiceOptions, type TurnOptions } from "./service.js";
export { ChatStore, type SessionState } from "./store.js";
