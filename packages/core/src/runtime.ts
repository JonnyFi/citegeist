import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AiRouter,
  type AiRoutingSettings,
  type InferenceBackend,
  type RunTaskOptions,
  type TaskName,
} from "@citegeist/ai";
import {
  type AlertLookup,
  createResolver,
  type GraphLookup,
  type MetadataConfig,
} from "@citegeist/metadata";
import { Registry } from "@citegeist/ops";
import {
  type AlertSchedule,
  type AlertService,
  bindAlertOperations,
  scheduleAlerts,
} from "./alerts/index.js";
import { bindCardOperations } from "./cards/index.js";
import { bindConceptOperations } from "./concepts/index.js";
import { bindGraphOperations, type GraphService } from "./graph/index.js";
import { bindIngestOperations } from "./ingest/index.js";
import type { IngestService, MetadataLookup } from "./ingest/service.js";
import { ChildProcessConvertWorker, type ConvertWorker } from "./ingest/worker.js";
import type { Library } from "./library.js";
import { bindLinkOperations } from "./links/index.js";
import { aiTaskJobs, bindMatrixOperations } from "./matrix/index.js";
import { bindNoteOperations } from "./notes/index.js";
import { bindCoreOperations } from "./ops.js";
import { bindPlanningOperations } from "./planning/index.js";
import { bindProjectContext } from "./project-context.js";
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
  NCBI_KEY_PROVIDER,
  type SettingsService,
} from "./settings/index.js";
import { type BindSyncOptions, bindSyncOperations, type SyncService } from "./sync/index.js";
import { bindTextsOperations } from "./texts/index.js";

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
  /** Tuning and test hooks for versioning and sync (quiet period, brctl runner, LFS check). */
  sync?: Omit<BindSyncOptions, "autoStart" | "onError">;
  /** Receives errors of background work such as sync commits. */
  onError?: (err: unknown) => void;
}

export interface Runtime {
  registry: Registry;
  ingest: IngestService;
  settings: SettingsService;
  /** Versioning and sync of the library folder (D5, A9). */
  sync: SyncService;
  /** Citation graph, snowballing and retraction checks. */
  graph: GraphService;
  /** Saved watches that put new works into the inbox. */
  alerts: AlertService;
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

/** What the metadata resolver takes from the machine settings. */
interface ResolverSettings {
  /** Contact address (Crossref, OpenAlex). */
  mailto?: string | undefined;
  /** Address for Unpaywall; `mailto` when unset. */
  unpaywallEmail?: string | undefined;
  /** `tool` parameter of NCBI E-utilities. */
  ncbiTool?: string | undefined;
  /** Free NCBI key from the Keychain. */
  ncbiApiKey?: string | undefined;
}

function resolverConfig(s: ResolverSettings): MetadataConfig {
  return {
    ...(s.mailto ? { mailto: s.mailto } : {}),
    ...(s.unpaywallEmail ? { unpaywallEmail: s.unpaywallEmail } : {}),
    ...(s.ncbiTool ? { ncbiTool: s.ncbiTool } : {}),
    ...(s.ncbiApiKey ? { ncbiApiKey: s.ncbiApiKey } : {}),
  };
}

/** Metadata resolver that follows the contact address, Unpaywall address and NCBI settings. */
function followingResolver(initial: ResolverSettings): {
  lookup: MetadataLookup;
  graph: GraphLookup;
  alerts: AlertLookup;
  use(next: ResolverSettings): void;
} {
  const make = (s: ResolverSettings) => createResolver({ config: resolverConfig(s) });
  let current = make(initial);
  let applied = JSON.stringify(resolverConfig(initial));
  return {
    lookup: {
      resolve: (input, options) => current.resolve(input, options),
      resolveByTitle: (query, options) => current.resolveByTitle(query, options),
    },
    graph: {
      crossrefReferences: (doi, limit) => current.crossrefReferences(doi, limit),
      openAlexReferences: (key, limit) => current.openAlexReferences(key, limit),
      openAlexCiting: (key, options) => current.openAlexCiting(key, options),
      openAlexDoi: (openalex) => current.openAlexDoi(openalex),
      retractionStatus: (doi) => current.retractionStatus(doi),
      findVersions: (key) => current.findVersions(key),
    },
    alerts: { alertWorks: (query) => current.alertWorks(query) },
    use(next) {
      const key = JSON.stringify(resolverConfig(next));
      if (key === applied) return;
      applied = key;
      current = make(next);
    },
  };
}

/** Stands in for the graph lookups when a caller passes its own resolver that has none. */
function noGraphLookup(): GraphLookup {
  const fail = (): Promise<never> =>
    Promise.reject(new Error("the resolver given to the runtime has no citation graph lookups"));
  return {
    crossrefReferences: fail,
    openAlexReferences: fail,
    openAlexCiting: fail,
    openAlexDoi: fail,
    retractionStatus: fail,
    findVersions: fail,
  };
}

/** Stands in for the alert lookups when a caller passes its own resolver that has none. */
function noAlertLookup(): AlertLookup {
  return {
    alertWorks: () =>
      Promise.reject(new Error("the resolver given to the runtime has no alert lookups")),
  };
}

function isAlertLookup(value: object): value is AlertLookup {
  return "alertWorks" in value;
}

function isGraphLookup(value: object): value is GraphLookup {
  return "crossrefReferences" in value && "openAlexCiting" in value && "findVersions" in value;
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
  bindPlanningOperations(registry, lib, {
    rank: async (query, texts) => semantic?.rank(query, texts),
  });
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

  const resolver = opts.resolver
    ? undefined
    : followingResolver(opts.mailto ? { mailto: opts.mailto } : {});
  // Sync is bound last, but ingest asks it for evicted iCloud files while converting.
  let sync: SyncService | undefined;
  const ingest = bindIngestOperations(registry, lib, {
    resolver: opts.resolver ?? (resolver as NonNullable<typeof resolver>).lookup,
    worker,
    ai,
    ensureLocal: async (rel) => (sync ? sync.ensureLocal(rel) : true),
    ...(opts.autoStart === undefined ? {} : { autoStart: opts.autoStart }),
  });

  // The resolver follows the settings. The NCBI key sits in the Keychain, which answers
  // asynchronously, so it joins the resolver as soon as it is read.
  let ncbiApiKey: string | undefined;
  let latest: ResolverSettings = {};
  const applyResolverSettings = (s: ResolverSettings): void => {
    latest = {
      mailto: s.mailto ?? opts.mailto,
      unpaywallEmail: s.unpaywallEmail,
      ncbiTool: s.ncbiTool,
    };
    resolver?.use({ ...latest, ncbiApiKey });
  };
  const readNcbiKey = (): void => {
    if (!resolver) return;
    void deps.keychain.get(NCBI_KEY_PROVIDER).then(
      (key) => {
        ncbiApiKey = key;
        resolver.use({ ...latest, ncbiApiKey });
      },
      () => undefined,
    );
  };

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
      applyResolverSettings(settings);
      readNcbiKey();
      void semantic?.configure(settings.semantic.enabled, settings.semantic.model);
    },
  });
  provider = fixed ? fixedBackends(fixed) : (opts.settings?.backends ?? deps.backends);
  service = bindSettingsOperations(registry, { ...deps, backends: provider });
  applyResolverSettings(deps.store.load());
  readNcbiKey();
  bindTextsOperations(registry, lib, {
    localBase,
    queue: ingest.queue,
    // A one-shot process (the CLI) never runs the queue, so the setup downloads right away.
    inline: opts.autoStart === false,
    ...(opts.settings?.runner ? { runner: opts.settings.runner } : {}),
    ...(opts.settings?.fetch ? { fetch: opts.settings.fetch } : {}),
  });

  // AI work (cards, links, matrix fills) runs as real jobs, so jobs.get answers for the ids the
  // operations return and shows the progress of a fill. A one-shot process (the CLI) does not run
  // the queue and keeps the detached fallback.
  const jobs = opts.autoStart !== false ? aiTaskJobs(ingest.queue) : undefined;
  bindCardOperations(registry, lib, { ai, ...(jobs ? { jobs } : {}) });
  bindLinkOperations(registry, lib, { ai, ...(jobs ? { jobs } : {}) });
  bindConceptOperations(registry, lib, { ai, ...(jobs ? { jobs } : {}) });
  bindMatrixOperations(registry, lib, {
    ai,
    ...(jobs ? { jobs } : {}),
    search: async (input) => (semantic ? semantic.search(input) : lib.search(input)),
    rank: async (query, texts) => semantic?.rank(query, texts),
  });

  const graphLookup: GraphLookup =
    resolver?.graph ??
    (opts.resolver && isGraphLookup(opts.resolver) ? opts.resolver : noGraphLookup());
  const graph = bindGraphOperations(registry, lib, {
    lookup: graphLookup,
    addItem: (actor, input) => ingest.addItem(actor, input),
    queue: ingest.queue,
  });
  const alerts = bindAlertOperations(registry, lib, {
    lookup:
      resolver?.alerts ??
      (opts.resolver && isAlertLookup(opts.resolver) ? opts.resolver : noAlertLookup()),
    addItem: (actor, input) => ingest.addItem(actor, input),
    queue: ingest.queue,
    rank: async (query, texts) => semantic?.rank(query, texts),
  });
  bindProjectContext(registry);

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

  let alertSchedule: AlertSchedule | undefined;
  if (opts.autoStart !== false) {
    graph.schedule();
    alertSchedule = scheduleAlerts(alerts);
  }

  // Last, because it wraps registry.call to commit library changes as the actor of the operation.
  const syncService = bindSyncOperations(registry, lib, {
    ...opts.sync,
    ...(opts.onError ? { onError: opts.onError } : {}),
    ...(opts.autoStart === false ? { autoStart: false } : {}),
  });
  sync = syncService;
  if (opts.autoStart !== false) {
    void syncService.start().catch((err) => opts.onError?.(err));
  }

  return {
    registry,
    ingest,
    settings: service,
    sync: syncService,
    graph,
    alerts,
    ...(semantic ? { semantic } : {}),
    close: async () => {
      graph.stop();
      alertSchedule?.stop();
      semantic?.close();
      syncService.close();
      await ingest.close();
    },
  };
}
