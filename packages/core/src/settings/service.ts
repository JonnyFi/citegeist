import { existsSync } from "node:fs";
import { type AiRoutingSettings, type ProcessRunner, runTask, TASK_NAMES } from "@citegeist/ai";
import {
  aiTestBackend,
  type ConnectorStatus as ConnectorStatusSchema,
  type Registry,
  type SemanticStatus as SemanticStatusSchema,
  type Settings as SettingsSchema,
  settingsGet,
  settingsUpdate,
  workerSetup,
} from "@citegeist/ops";
import { CitegeistError } from "@citegeist/schema";
import type { z } from "zod";
import type { ConvertWorker } from "../ingest/worker.js";
import type { JobQueue } from "../jobs/queue.js";
import { BACKEND_IDS, type BackendProvider, KEY_PROVIDERS } from "./backends.js";
import type { Keychain } from "./keychain.js";
import type { SettingsStore } from "./store.js";
import { runWorkerSetup, type WorkerEnvConfig } from "./worker-setup.js";

export type MachineSettings = z.infer<typeof SettingsSchema>;

type JobKind = Parameters<JobQueue["register"]>[0];

export interface SettingsDeps {
  /** Machine-local settings file. */
  store: SettingsStore;
  keychain: Keychain;
  backends: BackendProvider;
  /** The core's job queue; `worker.setup` runs as a job on it. */
  queue: JobQueue;
  worker: ConvertWorker;
  workerConfig: WorkerEnvConfig;
  runner?: ProcessRunner;
  /** Called after every successful `settings.update`, so the runtime can retarget the AiRouter. */
  onChange?: (settings: MachineSettings) => void;
  /** Job kind for `worker.setup`. Default `worker-setup`. */
  jobKind?: JobKind;
  /** How long a worker health answer is reused, in ms. Default 15000. */
  healthCacheMs?: number;
  /** Time limit of one worker health call, in ms. Default 8000. */
  healthTimeoutMs?: number;
}

const SAMPLE_PASSAGE =
  "Social systems consist of communications, not of people. Communication produces further communication.";

function invalid(message: string, fix: string): CitegeistError {
  return new CitegeistError({
    code: "SETTINGS_INVALID",
    message,
    fix,
    recovery: "fix-and-retry",
    sideEffects: "none",
  });
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function scrub(text: string): string {
  return text.replace(/\b(sk|xai|pk|key)-[A-Za-z0-9_-]{8,}/g, "<key>");
}

function errorOf(err: unknown): { code: string; message: string; fix: string } {
  if (err instanceof CitegeistError) {
    const d = err.detail;
    return { code: d.code, message: scrub(d.message), fix: scrub(d.fix) };
  }
  return {
    code: "AI_BACKEND_FAILED",
    message: scrub(err instanceof Error ? err.message : String(err)),
    fix: "Retry. If it keeps failing, check the backend setup or choose another backend.",
  };
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`no answer within ${ms} ms`)), ms);
  });
  return Promise.race([p, limit]).finally(() => clearTimeout(timer));
}

type WorkerStatus = {
  ready: boolean;
  engines: Record<string, string>;
  detail?: string;
};

type SemanticStatus = z.output<typeof SemanticStatusSchema>;
type ConnectorStatus = z.output<typeof ConnectorStatusSchema>;

/** Live state that other parts of the core report into `settings.get`. */
export interface StatusProviders {
  semantic?: () => SemanticStatus;
  connector?: () => ConnectorStatus;
}

export class SettingsService {
  /** Set by the runtime (semantic search) and by the app's core process (connector). */
  readonly status: StatusProviders = {};
  private readonly listeners = new Set<(settings: MachineSettings) => void | Promise<void>>();
  private readonly kind: JobKind;
  private health: { at: number; value: WorkerStatus } | undefined;

  constructor(private readonly deps: SettingsDeps) {
    this.kind = deps.jobKind ?? "worker-setup";
    deps.queue.register(
      this.kind,
      async (ctx) => {
        const force = (ctx.job.input as { force?: boolean } | null)?.force === true;
        try {
          return await runWorkerSetup(
            ctx,
            {
              ...(deps.runner ? { runner: deps.runner } : {}),
              worker: deps.worker,
              config: deps.workerConfig,
            },
            force,
          );
        } finally {
          this.health = undefined;
        }
      },
      { concurrency: 1, maxAttempts: 1 },
    );
  }

  /** The stored settings plus which API keys exist. Keys themselves are never read here. */
  async settings(): Promise<MachineSettings> {
    const stored = this.deps.store.load();
    const apiKeys: Record<string, boolean> = {};
    for (const provider of KEY_PROVIDERS)
      apiKeys[provider] = await this.deps.keychain.has(provider);
    return {
      ai: { routing: stored.ai.routing, apiKeys },
      ...(stored.mailto ? { mailto: stored.mailto } : {}),
      uiLanguage: stored.uiLanguage,
      semantic: { ...stored.semantic },
      connector: { ...stored.connector },
      chat: { ...stored.chat },
    };
  }

  /** A11: true when chat agents run in the sandbox instead of the user's own environment. */
  chatIsolated(): boolean {
    return this.deps.store.load().chat.isolated;
  }

  /** Routing in the shape the AiRouter takes. */
  routing(): AiRoutingSettings {
    return { routing: { ...this.deps.store.load().ai.routing } };
  }

  async update(input: z.output<typeof settingsUpdate.input>): Promise<MachineSettings> {
    const stored = this.deps.store.load();
    const { patch } = input;

    if (patch.ai?.routing) {
      const routing = patch.ai.routing;
      if (!routing["*"]) {
        throw invalid(
          'The routing needs a default entry for "*".',
          'Add "*" with the backend that serves every task without its own entry.',
        );
      }
      for (const [task, id] of Object.entries(routing)) {
        if (task !== "*" && !(TASK_NAMES as string[]).includes(task)) {
          throw invalid(
            `Unknown task ${task} in the routing.`,
            `Use "*" or one of: ${TASK_NAMES.join(", ")}.`,
          );
        }
        if (!BACKEND_IDS.includes(id)) {
          throw invalid(
            `Unknown backend ${id} for ${task}.`,
            `Use one of: ${BACKEND_IDS.join(", ")}.`,
          );
        }
      }
      stored.ai.routing = { ...routing };
    }

    for (const [provider, keep] of Object.entries(patch.ai?.apiKeys ?? {})) {
      if (!KEY_PROVIDERS.includes(provider)) {
        throw invalid(
          `No API key slot named ${provider}.`,
          `Use one of: ${KEY_PROVIDERS.join(", ")}.`,
        );
      }
      if (!keep) await this.deps.keychain.delete(provider);
    }

    if (input.apiKey) {
      const { provider, key } = input.apiKey;
      if (!KEY_PROVIDERS.includes(provider)) {
        throw invalid(
          `No API key slot named ${provider}.`,
          `Use one of: ${KEY_PROVIDERS.join(", ")}.`,
        );
      }
      await this.deps.keychain.set(provider, key.trim());
    }

    if (patch.mailto !== undefined) {
      const mail = patch.mailto.trim();
      if (mail && !EMAIL.test(mail)) {
        throw invalid(
          "The contact address is not an email address.",
          "Enter an address like name@example.org.",
        );
      }
      if (mail) stored.mailto = mail;
      else delete stored.mailto;
    }
    if (patch.uiLanguage) stored.uiLanguage = patch.uiLanguage;
    if (patch.semantic) {
      const model = patch.semantic.model ?? stored.semantic.model;
      stored.semantic = {
        enabled: patch.semantic.enabled ?? stored.semantic.enabled,
        ...(model ? { model } : {}),
      };
    }
    if (patch.connector) {
      stored.connector = {
        enabled: patch.connector.enabled ?? stored.connector.enabled,
        port: patch.connector.port ?? stored.connector.port,
      };
    }

    if (patch.chat?.isolated !== undefined) stored.chat = { isolated: patch.chat.isolated };

    this.deps.store.save(stored);
    const settings = await this.settings();
    this.deps.onChange?.(settings);
    // settings.update answers after the listeners have acted, so settings.get shows their state.
    await Promise.all([...this.listeners].map((listener) => listener(settings)));
    return settings;
  }

  /** Calls `listener` after every successful `settings.update`. Returns the unsubscribe function. */
  subscribe(listener: (settings: MachineSettings) => void | Promise<void>): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async workerStatus(): Promise<WorkerStatus> {
    const running = this.setupJob();
    if (running) return { ready: false, engines: {}, detail: "installing" };
    if (!existsSync(this.deps.workerConfig.envDir)) {
      return { ready: false, engines: {}, detail: "not-installed" };
    }
    const ttl = this.deps.healthCacheMs ?? 15_000;
    if (this.health && Date.now() - this.health.at < ttl) return this.health.value;
    let value: WorkerStatus;
    try {
      const h = await withTimeout(this.deps.worker.health(), this.deps.healthTimeoutMs ?? 8000);
      value = { ready: h.ready, engines: h.engines, ...(h.ready ? {} : { detail: "not-ready" }) };
    } catch (err) {
      value = {
        ready: false,
        engines: {},
        detail: `unreachable: ${scrub(err instanceof Error ? err.message : String(err)).slice(0, 200)}`,
      };
    }
    this.health = { at: Date.now(), value };
    return value;
  }

  private setupJob(): { id: string } | undefined {
    for (const status of ["running", "queued"]) {
      const job = this.deps.queue
        .list({ status, limit: 50 })
        .jobs.find((j) => j.kind === this.kind);
      if (job) return job;
    }
    return undefined;
  }

  /** Starts the setup job, or returns the one that is already queued or running. */
  startSetup(by: "human" | "agent" | "system" | string, force: boolean): string {
    const existing = this.setupJob();
    if (existing) return existing.id;
    this.health = undefined;
    return this.deps.queue.enqueue({
      kind: this.kind,
      by: by as never,
      input: { force },
      maxAttempts: 1,
    }).id;
  }

  async testBackend(id: string): Promise<z.input<typeof aiTestBackend.output>> {
    try {
      const backend = await this.deps.backends.get(id);
      const language = this.deps.store.load().uiLanguage;
      const result = await runTask(
        backend,
        "card.paraphrase",
        { passage: SAMPLE_PASSAGE },
        { language },
      );
      return { ok: true, latencyMs: result.ms };
    } catch (err) {
      return { ok: false, error: errorOf(err) };
    }
  }
}

/**
 * Binds settings.get, settings.update, ai.testBackend and worker.setup. Registers the
 * `worker.setup` job handler on `deps.queue`. Returns the service, so the runtime can read the
 * routing and build backends from it.
 */
export function bindSettingsOperations(registry: Registry, deps: SettingsDeps): SettingsService {
  const svc = new SettingsService(deps);
  registry
    .bind(settingsGet, async () => ({
      settings: await svc.settings(),
      backends: await deps.backends.status(),
      worker: await svc.workerStatus(),
      ...(svc.status.semantic ? { semantic: svc.status.semantic() } : {}),
      ...(svc.status.connector ? { connector: svc.status.connector() } : {}),
    }))
    .bind(settingsUpdate, async (_ctx, input) => ({ settings: await svc.update(input) }))
    .bind(aiTestBackend, async (_ctx, input) => svc.testBackend(input.backend))
    .bind(workerSetup, async (ctx, input) => ({ job: svc.startSetup(ctx.actor, input.force) }));
  return svc;
}
