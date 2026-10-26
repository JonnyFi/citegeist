import {
  aiTestBackend,
  jobsGet,
  Registry,
  settingsGet,
  settingsUpdate,
  usageSummary,
  workerSetup,
} from "@citegeist/ops";
import { CitegeistError } from "@citegeist/schema";
import type { z } from "zod";
import { type Core, type CoreEvent, coreFromLink } from "../lib/core";

type Backend = z.input<typeof settingsGet.output>["backends"][number];
type TestResult = z.input<typeof aiTestBackend.output>;

export interface SettingsMockState {
  routing: Record<string, string>;
  /** Fallback order in effect. The default is every backend that is not local, as in the core. */
  fallback: string[];
  apiKeys: Record<string, boolean>;
  mailto?: string;
  unpaywallEmail?: string;
  ncbiTool?: string;
  uiLanguage?: "de" | "en";
  backends: Backend[];
  worker: { ready: boolean; engines: Record<string, string>; detail?: string };
  semantic: {
    enabled: boolean;
    /** The embedding model the user picked. */
    model?: "embeddinggemma-300m" | "qwen3-embedding-0.6b";
    /** What the model reports once enabled. "downloading" ends after `semanticPolls` reads. */
    state: "downloading" | "ready" | "error";
    progress: number;
    detail?: string;
    /** Re-sorting of the best hits by a second model. */
    rerank?: boolean;
  };
  semanticPolls: number;
  connector: { enabled: boolean; port: number; error?: string };
  webhooks: { port: number; publicUrl?: string };
  chat: { isolated: boolean };
  research: { maxMinutes: number; maxTokens: number; maxToolCalls: number };
  /** Answer of `usage.summary` per window in days. A missing window answers with no calls. */
  usage: Record<number, z.input<typeof usageSummary.output>>;
  /** Result of `ai.testBackend` per backend id. Missing ids succeed after 1.2 s. */
  tests: Record<string, TestResult>;
  /** Polls of `jobs.get` before the setup job ends. */
  setupPolls: number;
  /** Error the setup job ends with. Unset means success. */
  setupError?: { code: string; message: string };
}

export function createSettingsMockState(over: Partial<SettingsMockState> = {}): SettingsMockState {
  return {
    routing: { "*": "claude-code-cli" },
    fallback: ["claude-code-cli", "codex-exec", "cursor-cli", "openai", "anthropic"],
    apiKeys: {
      openai: false,
      anthropic: false,
      openrouter: false,
      xai: false,
      ncbi: false,
      openalex: false,
    },
    backends: [
      {
        id: "claude-code-cli",
        kind: "subscription-cli",
        label: "Claude Code CLI",
        available: true,
        detail: "ready",
      },
      {
        id: "codex-exec",
        kind: "subscription-cli",
        label: "Codex CLI",
        available: false,
        detail: "not-installed",
        error: {
          code: "AI_CLI_MISSING",
          message: "The `codex` command was not found on PATH or in the usual install folders.",
          fix: "Install the Codex CLI (`npm install -g @openai/codex`), run `codex login`, then retry.",
          recovery: "do-first",
        },
      },
      {
        id: "cursor-cli",
        kind: "subscription-cli",
        label: "Cursor CLI",
        available: false,
        detail: "not-installed",
        error: {
          code: "AI_CLI_MISSING",
          message: "The `agent` command was not found on PATH or in the usual install folders.",
          fix: "Install the Cursor CLI (https://cursor.com/cli), run `agent login`, then retry.",
          recovery: "do-first",
        },
      },
      { id: "ollama", kind: "local", label: "Ollama", available: false, detail: "unreachable" },
      { id: "openai", kind: "api-key", label: "OpenAI API", available: false, detail: "no-key" },
      {
        id: "anthropic",
        kind: "api-key",
        label: "Anthropic API",
        available: false,
        detail: "no-key",
      },
    ],
    worker: { ready: false, engines: {}, detail: "not-installed" },
    semantic: { enabled: false, model: "embeddinggemma-300m", state: "downloading", progress: 0 },
    semanticPolls: 3,
    connector: { enabled: false, port: 23119 },
    webhooks: { port: 47321 },
    chat: { isolated: false },
    research: { maxMinutes: 20, maxTokens: 2_000_000, maxToolCalls: 200 },
    usage: {},
    tests: {},
    setupPolls: 2,
    ...over,
  };
}

const JOB_ID = `j_01J${"0".repeat(23)}`;

/** Binds settings.get, settings.update, ai.testBackend, worker.setup and jobs.get to in-memory state. */
export function bindSettingsMock(
  registry: Registry,
  state: SettingsMockState,
  emit: (e: CoreEvent) => void = () => {},
  /** `false` leaves `worker.setup` and `jobs.get` to the caller, who has its own jobs. */
  withJobs = true,
): Registry {
  let polls = 0;
  let jobStarted = false;
  const settings = () => ({
    ai: {
      routing: { ...state.routing },
      fallback: [...state.fallback],
      apiKeys: { ...state.apiKeys },
    },
    ...(state.mailto ? { mailto: state.mailto } : {}),
    ...(state.unpaywallEmail ? { unpaywallEmail: state.unpaywallEmail } : {}),
    ...(state.ncbiTool ? { ncbiTool: state.ncbiTool } : {}),
    ...(state.uiLanguage ? { uiLanguage: state.uiLanguage } : {}),
    semantic: {
      enabled: state.semantic.enabled,
      model: state.semantic.model ?? "embeddinggemma-300m",
      rerank: state.semantic.rerank === true,
    },
    connector: { enabled: state.connector.enabled, port: state.connector.port },
    webhooks: {
      port: state.webhooks.port,
      ...(state.webhooks.publicUrl ? { publicUrl: state.webhooks.publicUrl } : {}),
    },
    chat: { isolated: state.chat.isolated },
    research: { ...state.research },
  });
  let semanticReads = 0;
  const semanticStatus = () => {
    const { enabled, state: shown, progress, detail } = state.semantic;
    const model = state.semantic.model ?? "embeddinggemma-300m";
    if (!enabled) return { state: "off" as const, model };
    if (shown === "downloading") {
      semanticReads++;
      if (semanticReads >= state.semanticPolls) {
        return {
          state: "ready" as const,
          model,
          ...(state.semantic.rerank ? { rerank: "ready" as const } : {}),
        };
      }
      return {
        state: "downloading" as const,
        model,
        progress: Math.max(progress, semanticReads / state.semanticPolls),
      };
    }
    return {
      state: shown,
      model,
      ...(detail ? { detail } : {}),
      ...(shown === "ready" && state.semantic.rerank ? { rerank: "ready" as const } : {}),
    };
  };
  const connectorStatus = () => {
    const { enabled, port, error } = state.connector;
    if (!enabled) return { state: "off" as const };
    return error
      ? { state: "error" as const, detail: error }
      : { state: "listening" as const, port };
  };
  const now = () => new Date().toISOString();

  registry
    .bind(settingsGet, async () => ({
      settings: settings(),
      backends: state.backends.map((b) => ({ ...b })),
      worker: {
        ...state.worker,
        engines: { ...state.worker.engines },
        ...(jobStarted && polls < state.setupPolls ? { detail: "installing" } : {}),
      },
      semantic: semanticStatus(),
      connector: connectorStatus(),
    }))
    .bind(settingsUpdate, async (_ctx, input) => {
      const { patch, apiKey } = input;
      if (patch.ai?.routing) state.routing = { ...patch.ai.routing };
      if (patch.ai?.fallback) state.fallback = [...patch.ai.fallback];
      for (const [provider, keep] of Object.entries(patch.ai?.apiKeys ?? {})) {
        if (!keep) setKey(state, provider, false);
      }
      if (apiKey) setKey(state, apiKey.provider, true);
      if (patch.mailto !== undefined) {
        const mail = checkMail(patch.mailto, "The contact address");
        if (mail) state.mailto = mail;
        else delete state.mailto;
      }
      if (patch.unpaywallEmail !== undefined) {
        const mail = checkMail(patch.unpaywallEmail, "The Unpaywall address");
        if (mail) state.unpaywallEmail = mail;
        else delete state.unpaywallEmail;
      }
      if (patch.ncbiTool !== undefined) {
        const tool = patch.ncbiTool.trim();
        if (tool) state.ncbiTool = tool;
        else delete state.ncbiTool;
      }
      if (patch.uiLanguage) state.uiLanguage = patch.uiLanguage;
      if (patch.semantic) {
        const turnsOn = patch.semantic.enabled && !state.semantic.enabled;
        const switches =
          patch.semantic.model &&
          patch.semantic.model !== (state.semantic.model ?? "embeddinggemma-300m");
        // A new model has to be downloaded again.
        if (turnsOn || switches) semanticReads = 0;
        state.semantic.enabled = patch.semantic.enabled ?? state.semantic.enabled;
        if (patch.semantic.model) state.semantic.model = patch.semantic.model;
        if (patch.semantic.rerank !== undefined) state.semantic.rerank = patch.semantic.rerank;
      }
      if (patch.connector) {
        state.connector.enabled = patch.connector.enabled ?? state.connector.enabled;
        state.connector.port = patch.connector.port ?? state.connector.port;
      }
      if (patch.webhooks) {
        state.webhooks.port = patch.webhooks.port ?? state.webhooks.port;
        if (patch.webhooks.publicUrl !== undefined) {
          const url = patch.webhooks.publicUrl.trim().replace(/\/+$/, "");
          if (url) state.webhooks.publicUrl = url;
          else delete state.webhooks.publicUrl;
        }
      }
      if (patch.chat?.isolated !== undefined) state.chat.isolated = patch.chat.isolated;
      if (patch.research) {
        state.research = {
          maxMinutes: patch.research.maxMinutes ?? state.research.maxMinutes,
          maxTokens: patch.research.maxTokens ?? state.research.maxTokens,
          maxToolCalls: patch.research.maxToolCalls ?? state.research.maxToolCalls,
        };
      }
      emit({ type: "change", path: "settings", external: false });
      return { settings: settings() };
    })
    .bind(aiTestBackend, async (_ctx, input) => {
      return state.tests[input.backend] ?? { ok: true, latencyMs: 1200 };
    })
    .bind(usageSummary, async (_ctx, input) => state.usage[input.days] ?? emptyUsage(input.days));
  if (!withJobs) return registry;
  return registry
    .bind(workerSetup, async () => {
      jobStarted = true;
      polls = 0;
      return { job: JOB_ID };
    })
    .bind(jobsGet, async () => {
      polls++;
      const base = {
        id: JOB_ID,
        kind: "worker-setup" as const,
        input: null,
        attempts: 1,
        by: "human" as const,
        createdAt: now(),
        updatedAt: now(),
      };
      if (polls < state.setupPolls) {
        return {
          ...base,
          status: "running" as const,
          progress: 0.4,
          message: "Installing the Python environment",
        };
      }
      if (state.setupError) {
        return { ...base, status: "failed" as const, progress: 0.4, error: state.setupError };
      }
      state.worker = { ready: true, engines: { docling: "2.0", ocrmypdf: "16.0" } };
      return { ...base, status: "succeeded" as const, progress: 1, message: "Worker ready" };
    });
}

const NO_USAGE = {
  calls: 0,
  failed: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  costUsd: 0,
  pricedCalls: 0,
  ms: 0,
};

/** `usage.summary` with no calls in the window. */
export function emptyUsage(days: number): z.input<typeof usageSummary.output> {
  return {
    days,
    since: new Date(Date.now() - days * 86_400_000).toISOString(),
    totals: { ...NO_USAGE },
    byDay: [],
    byTask: [],
    byBackend: [],
  };
}

/** A believable week or month of usage, for the browser preview and tests. */
export function sampleUsage(days: number): z.input<typeof usageSummary.output> {
  const scale = days >= 30 ? 4 : 1;
  const row = (calls: number, input: number, output: number, cache: number, cost: number) => ({
    calls: calls * scale,
    failed: 0,
    inputTokens: input * scale,
    outputTokens: output * scale,
    cacheReadTokens: cache * scale,
    cacheWriteTokens: 0,
    costUsd: cost * scale,
    pricedCalls: calls * scale,
    ms: calls * scale * 2400,
  });
  const paraphrase = row(42, 21_000, 9_600, 180_000, 0.08);
  const links = row(6, 18_000, 3_000, 40_000, 0.06);
  const totals = row(48, 39_000, 12_600, 220_000, 0.14);
  return {
    days,
    since: new Date(Date.now() - days * 86_400_000).toISOString(),
    totals,
    byDay: [{ day: new Date().toISOString().slice(0, 10), ...totals }],
    byTask: [
      { task: "card.paraphrase", ...paraphrase },
      { task: "note.proposeLinks", ...links },
    ],
    byBackend: [{ backend: "claude-code-cli", ...totals }],
  };
}

function checkMail(raw: string, subject: string): string {
  const mail = raw.trim();
  if (mail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) {
    throw new CitegeistError({
      code: "SETTINGS_INVALID",
      message: `${subject} is not an email address.`,
      fix: "Enter an address like name@example.org.",
      recovery: "fix-and-retry",
    });
  }
  return mail;
}

function setKey(state: SettingsMockState, provider: string, stored: boolean): void {
  state.apiKeys[provider] = stored;
  const backend = state.backends.find((b) => b.id === provider);
  if (backend) {
    backend.available = stored;
    backend.detail = stored ? "ready" : "no-key";
  }
}

/** A Core with only the settings operations, for component tests and previews. */
export function createSettingsMockCore(state: SettingsMockState = createSettingsMockState()) {
  const listeners = new Set<(e: CoreEvent) => void>();
  const registry = bindSettingsMock(new Registry(), state, (e) => {
    for (const l of listeners) l(e);
  });
  const calls: Array<{ name: string; input: unknown }> = [];
  const core: Core = coreFromLink(
    {
      async call(path, input) {
        const name = path.join(".");
        calls.push({ name, input });
        return registry.call(name, { actor: "human" }, input);
      },
    },
    {
      label: "mock settings",
      isMock: false,
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
  );
  return { core, state, calls };
}
