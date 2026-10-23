import {
  aiTestBackend,
  jobsGet,
  Registry,
  settingsGet,
  settingsUpdate,
  workerSetup,
} from "@citegeist/ops";
import { CitegeistError } from "@citegeist/schema";
import { z } from "zod";
import { type Core, type CoreEvent, coreFromLink } from "../lib/core";

type Backend = z.input<typeof settingsGet.output>["backends"][number];
type TestResult = z.input<typeof aiTestBackend.output>;

export interface SettingsMockState {
  routing: Record<string, string>;
  apiKeys: Record<string, boolean>;
  mailto?: string;
  uiLanguage: "de" | "en";
  backends: Backend[];
  worker: { ready: boolean; engines: Record<string, string>; detail?: string };
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
    apiKeys: { openai: false, anthropic: false, openrouter: false, xai: false },
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
    tests: {},
    setupPolls: 2,
    ...over,
  };
}

/** Same name and output as `settings.update`, with a patch whose fields are all optional. */
const settingsUpdateLoose = {
  ...settingsUpdate,
  input: z.object({
    patch: z.object({
      ai: z
        .object({
          routing: z.record(z.string(), z.string()).optional(),
          apiKeys: z.record(z.string(), z.boolean()).optional(),
        })
        .optional(),
      mailto: z.string().optional(),
      uiLanguage: z.enum(["de", "en"]).optional(),
    }),
    apiKey: z.object({ provider: z.string(), key: z.string().min(1) }).optional(),
  }),
};

const JOB_ID = `j_01J${"0".repeat(23)}`;

/** Binds settings.get, settings.update, ai.testBackend, worker.setup and jobs.get to in-memory state. */
export function bindSettingsMock(
  registry: Registry,
  state: SettingsMockState,
  emit: (e: CoreEvent) => void = () => {},
): Registry {
  let polls = 0;
  let jobStarted = false;
  const settings = () => ({
    ai: { routing: { ...state.routing }, apiKeys: { ...state.apiKeys } },
    ...(state.mailto ? { mailto: state.mailto } : {}),
    uiLanguage: state.uiLanguage,
  });
  const now = () => new Date().toISOString();

  return registry
    .bind(settingsGet, async () => ({
      settings: settings(),
      backends: state.backends.map((b) => ({ ...b })),
      worker: {
        ...state.worker,
        engines: { ...state.worker.engines },
        ...(jobStarted && polls < state.setupPolls ? { detail: "installing" } : {}),
      },
    }))
    .bind(settingsUpdateLoose, async (_ctx, input) => {
      const { patch, apiKey } = input;
      if (patch.ai?.routing) state.routing = { ...patch.ai.routing };
      for (const [provider, keep] of Object.entries(patch.ai?.apiKeys ?? {})) {
        if (!keep) setKey(state, provider, false);
      }
      if (apiKey) setKey(state, apiKey.provider, true);
      if (patch.mailto !== undefined) {
        const mail = patch.mailto.trim();
        if (mail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) {
          throw new CitegeistError({
            code: "SETTINGS_INVALID",
            message: "The contact address is not an email address.",
            fix: "Enter an address like name@example.org.",
            recovery: "fix-and-retry",
          });
        }
        if (mail) state.mailto = mail;
        else delete state.mailto;
      }
      if (patch.uiLanguage) state.uiLanguage = patch.uiLanguage;
      emit({ type: "change", path: "settings", external: false });
      return { settings: settings() };
    })
    .bind(aiTestBackend, async (_ctx, input) => {
      return state.tests[input.backend] ?? { ok: true, latencyMs: 1200 };
    })
    .bind(workerSetup, async () => {
      jobStarted = true;
      polls = 0;
      return { job: JOB_ID };
    })
    .bind(jobsGet, async () => {
      polls++;
      const base = {
        id: JOB_ID,
        kind: "enrich" as const,
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
