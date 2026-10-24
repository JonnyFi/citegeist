import {
  aiTestBackend,
  jobsGet,
  Registry,
  settingsGet,
  settingsUpdate,
  workerSetup,
} from "@citegeist/ops";
import { CitegeistError } from "@citegeist/schema";
import type { z } from "zod";
import { type Core, type CoreEvent, coreFromLink } from "../lib/core";

type Backend = z.input<typeof settingsGet.output>["backends"][number];
type TestResult = z.input<typeof aiTestBackend.output>;

export interface SettingsMockState {
  routing: Record<string, string>;
  apiKeys: Record<string, boolean>;
  mailto?: string;
  unpaywallEmail?: string;
  ncbiTool?: string;
  uiLanguage: "de" | "en";
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
  };
  semanticPolls: number;
  connector: { enabled: boolean; port: number; error?: string };
  chat: { isolated: boolean };
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
    apiKeys: { openai: false, anthropic: false, openrouter: false, xai: false, ncbi: false },
    uiLanguage: "de",
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
    chat: { isolated: false },
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
    ai: { routing: { ...state.routing }, apiKeys: { ...state.apiKeys } },
    ...(state.mailto ? { mailto: state.mailto } : {}),
    ...(state.unpaywallEmail ? { unpaywallEmail: state.unpaywallEmail } : {}),
    ...(state.ncbiTool ? { ncbiTool: state.ncbiTool } : {}),
    uiLanguage: state.uiLanguage,
    semantic: {
      enabled: state.semantic.enabled,
      model: state.semantic.model ?? "embeddinggemma-300m",
    },
    connector: { enabled: state.connector.enabled, port: state.connector.port },
    chat: { isolated: state.chat.isolated },
  });
  let semanticReads = 0;
  const semanticStatus = () => {
    const { enabled, state: shown, progress, detail } = state.semantic;
    const model = state.semantic.model ?? "embeddinggemma-300m";
    if (!enabled) return { state: "off" as const, model };
    if (shown === "downloading") {
      semanticReads++;
      if (semanticReads >= state.semanticPolls) return { state: "ready" as const, model };
      return {
        state: "downloading" as const,
        model,
        progress: Math.max(progress, semanticReads / state.semanticPolls),
      };
    }
    return { state: shown, model, ...(detail ? { detail } : {}) };
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
      if (patch.ai) state.routing = { ...patch.ai.routing };
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
      }
      if (patch.connector) {
        state.connector.enabled = patch.connector.enabled ?? state.connector.enabled;
        state.connector.port = patch.connector.port ?? state.connector.port;
      }
      if (patch.chat?.isolated !== undefined) state.chat.isolated = patch.chat.isolated;
      emit({ type: "change", path: "settings", external: false });
      return { settings: settings() };
    })
    .bind(aiTestBackend, async (_ctx, input) => {
      return state.tests[input.backend] ?? { ok: true, latencyMs: 1200 };
    });
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
