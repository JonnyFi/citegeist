import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AiRouter,
  type AiRoutingSettings,
  type InferenceBackend,
  type RunTaskOptions,
  type TaskName,
} from "@citegeist/ai";
import { createResolver } from "@citegeist/metadata";
import { Registry } from "@citegeist/ops";
import { bindCardOperations } from "./cards/index.js";
import type { CardJobQueue } from "./cards/jobs.js";
import { bindIngestOperations } from "./ingest/index.js";
import type { IngestService, MetadataLookup } from "./ingest/service.js";
import { ChildProcessConvertWorker, type ConvertWorker } from "./ingest/worker.js";
import type { Library } from "./library.js";
import { bindLinkOperations } from "./links/index.js";
import { bindNoteOperations } from "./notes/index.js";
import { bindCoreOperations } from "./ops.js";
import {
  type AttachSemanticOptions,
  type ModelEmbedder,
  SemanticController,
  type SemanticControllerOptions,
} from "./semantic/index.js";
import {
  type BackendProvider,
  type BackendStatus,
  bindSettingsOperations,
  createSettingsDeps,
  type DefaultSettingsOptions,
  type SettingsService,
} from "./settings/index.js";

export interface RuntimeOptions {
  /**
   * Fixed inference backends and routing, for tests and for a stub in end-to-end runs. Without
   * it the router follows the stored settings: the backends the settings screen offers, the
   * routing the user chose, rebuilt after every `settings.update`.
   */
  ai?: { backends?: InferenceBackend[]; routing?: AiRoutingSettings };
  /** Machine-local settings: where they live and what backs the Keychain, process runner and HTTP. */
  settings?: Partial<
    Pick<DefaultSettingsOptions, "localBase" | "workerSource" | "keychain" | "runner" | "fetch">
  > & {
    /** Replaces the backends the settings screen lists and the router can use. */
    backends?: BackendProvider;
  };
  resolver?: MetadataLookup;
  worker?: ConvertWorker;
  /** Contact address for Crossref's polite pool. Default: the one in the settings. */
  mailto?: string;
  /** Start background jobs immediately. Default true. */
  autoStart?: boolean;
  /**
   * An embedder for semantic search that is always on, ignoring the settings switch. Tests pass
   * a fake one. Without it, semantic search follows `settings.semantic.enabled` and uses
   * EmbeddingGemma, which is downloaded when the switch is turned on and never before.
   */
  embedder?: ModelEmbedder;
  /** Tuning and test hooks for semantic search. Only used when background jobs run. */
  semantic?: Omit<AttachSemanticOptions, "embedder"> &
    Pick<SemanticControllerOptions, "createEmbedder">;
}

export interface Runtime {
  registry: Registry;
  ingest: IngestService;
  settings: SettingsService;
  /** Semantic search. Absent in a one-shot process, which does not run background jobs. */
  semantic?: SemanticController;
  close(): Promise<void>;
}

/** Repo root when running from source: packages/core/src -> three levels up. */
function repoRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
}

/** Repo-relative worker location for development; packaged builds set CITEGEIST_WORKER_CMD. */
function defaultWorker(): ConvertWorker {
  const override = process.env.CITEGEIST_WORKER_CMD;
  if (override) {
    const [command = "uv", ...args] = override.split(" ").filter(Boolean);
    return new ChildProcessConvertWorker({ command, args });
  }
  return new ChildProcessConvertWorker({
    command: "uv",
    args: ["run", "--directory", join(repoRoot(), "workers", "convert"), "citegeist-convert"],
  });
}

/** Backends handed in by the caller, shown in the settings as ready. */
function fixedBackends(list: InferenceBackend[]): BackendProvider {
  const status = (): BackendStatus[] =>
    list.map((b) => ({
      id: b.id,
      kind: "local" as const,
      label: b.id,
      available: true,
      detail: "ready",
    }));
  return {
    async get(id) {
      const backend = list.find((b) => b.id === id);
      if (!backend) throw new Error(`no backend ${id}`);
      return backend;
    },
    async status() {
      return status();
    },
    async build() {
      return list;
    },
  };
}

/** Metadata resolver that follows the contact address in the settings. */
function followingResolver(initial: string | undefined): {
  lookup: MetadataLookup;
  use(mailto: string | undefined): void;
} {
  const make = (mailto: string | undefined) => createResolver(mailto ? { config: { mailto } } : {});
  let current = make(initial);
  let mailto = initial;
  return {
    lookup: {
      resolve: (input, options) => current.resolve(input, options),
      resolveByTitle: (query, options) => current.resolveByTitle(query, options),
    },
    use(next) {
      if (next === mailto) return;
      mailto = next;
      current = make(next);
    },
  };
}

/**
 * Builds the full operation registry for one library: index-backed reads, notes and projects,
 * ingest with jobs, quote cards with AI and the machine settings. App, CLI and MCP all use this.
 */
export function createRuntime(lib: Library, opts: RuntimeOptions = {}): Runtime {
  // search.query is bound once. It asks the semantic controller, which answers with hybrid
  // search when the model is ready and with full-text search otherwise.
  let semantic: SemanticController | undefined;
  const registry = bindCoreOperations(new Registry(), lib, {
    search: async (input) => (semantic ? semantic.search(input) : lib.search(input)),
  });
  bindNoteOperations(registry, lib);
  const worker = opts.worker ?? defaultWorker();
  const localBase = opts.settings?.localBase ?? dirname(lib.local.dir);
  const workerSource = opts.settings?.workerSource ?? join(repoRoot(), "workers", "convert");

  const fixed = opts.ai?.backends;
  const fixedRouter = fixed
    ? new AiRouter(fixed, opts.ai?.routing ?? { routing: { "*": fixed[0]?.id ?? "mock" } })
    : undefined;

  // The router is rebuilt lazily after a settings change, because API keys add and remove backends.
  let service: SettingsService | undefined;
  let provider: BackendProvider | undefined;
  let router: Promise<AiRouter> | undefined;
  const currentRouter = (): Promise<AiRouter> => {
    router ??= (async () => {
      if (!service || !provider) throw new Error("the runtime is not ready");
      return new AiRouter(await provider.build(), service.routing());
    })();
    return router;
  };
  const ai = {
    async run<N extends TaskName>(task: N, input: unknown, runOpts?: RunTaskOptions) {
      return (fixedRouter ?? (await currentRouter())).run(task, input, runOpts);
    },
  };

  const resolver = opts.resolver ? undefined : followingResolver(opts.mailto);
  const ingest = bindIngestOperations(registry, lib, {
    resolver: opts.resolver ?? (resolver as NonNullable<typeof resolver>).lookup,
    worker,
    ...(opts.autoStart === undefined ? {} : { autoStart: opts.autoStart }),
  });

  const deps = createSettingsDeps({
    localBase,
    queue: ingest.queue,
    worker,
    workerSource,
    ...(opts.settings?.runner ? { runner: opts.settings.runner } : {}),
    ...(opts.settings?.keychain ? { keychain: opts.settings.keychain } : {}),
    ...(opts.settings?.fetch ? { fetch: opts.settings.fetch } : {}),
    onChange: (settings) => {
      router = undefined;
      resolver?.use(settings.mailto);
      void semantic?.configure(settings.semantic.enabled, settings.semantic.model);
    },
  });
  provider = fixed ? fixedBackends(fixed) : (opts.settings?.backends ?? deps.backends);
  service = bindSettingsOperations(registry, { ...deps, backends: provider });
  if (!opts.mailto) resolver?.use(deps.store.load().mailto);

  // Card AI work runs as real jobs, so jobs.get answers for the ids cards.create returns. A
  // one-shot process (the CLI) does not run the queue and keeps the detached fallback.
  let cardJobs: CardJobQueue | undefined;
  if (opts.autoStart !== false) {
    const runs = new Map<string, () => Promise<unknown>>();
    ingest.queue.register(
      "ai-task",
      async (ctx) => {
        const run = runs.get(ctx.job.id);
        runs.delete(ctx.job.id);
        if (!run) throw new Error("the AI job was queued by an earlier session and cannot resume");
        await run();
      },
      { concurrency: 2, maxAttempts: 1 },
    );
    cardJobs = {
      enqueue(spec) {
        const id = ingest.queue.newId();
        runs.set(id, () => spec.run());
        ingest.queue.enqueue({
          id,
          kind: spec.kind,
          by: spec.by,
          input: { label: spec.label, ...(spec.input as object) },
          maxAttempts: 1,
        });
        return id;
      },
    };
  }
  bindCardOperations(registry, lib, { ai, ...(cardJobs ? { jobs: cardJobs } : {}) });
  bindLinkOperations(registry, lib, { ai, ...(cardJobs ? { jobs: cardJobs } : {}) });

  // Semantic search needs the job queue to run, so a one-shot process leaves it out.
  if (opts.autoStart !== false) {
    const { createEmbedder, ...tuning } = opts.semantic ?? {};
    semantic = new SemanticController({
      lib,
      queue: ingest.queue,
      embedder: opts.embedder,
      createEmbedder,
      semantic: tuning,
    });
    const controller = semantic;
    service.status.semantic = () => controller.status();
    const stored = deps.store.load().semantic;
    void controller.configure(stored.enabled, stored.model);
  }

  return {
    registry,
    ingest,
    settings: service,
    ...(semantic ? { semantic } : {}),
    close: async () => {
      semantic?.close();
      await ingest.close();
    },
  };
}
