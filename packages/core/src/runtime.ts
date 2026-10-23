import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AiRouter,
  type AiRoutingSettings,
  ClaudeCodeCliBackend,
  type InferenceBackend,
} from "@citegeist/ai";
import { createResolver } from "@citegeist/metadata";
import { Registry } from "@citegeist/ops";
import { bindCardOperations } from "./cards/index.js";
import { bindIngestOperations } from "./ingest/index.js";
import type { IngestService, MetadataLookup } from "./ingest/service.js";
import { ChildProcessConvertWorker, type ConvertWorker } from "./ingest/worker.js";
import type { Library } from "./library.js";
import { bindCoreOperations } from "./ops.js";

export interface RuntimeOptions {
  /** Inference backends and task routing. Default: Claude Code CLI with the user's subscription. */
  ai?: { backends?: InferenceBackend[]; routing?: AiRoutingSettings };
  resolver?: MetadataLookup;
  worker?: ConvertWorker;
  /** Contact address for Crossref's polite pool, from the user's settings. */
  mailto?: string;
  /** Start background jobs immediately. Default true. */
  autoStart?: boolean;
}

export interface Runtime {
  registry: Registry;
  ingest: IngestService;
  close(): Promise<void>;
}

/** Repo-relative worker location for development; packaged builds set CITEGEIST_WORKER_CMD. */
function defaultWorker(): ConvertWorker {
  const override = process.env.CITEGEIST_WORKER_CMD;
  if (override) {
    const [command = "uv", ...args] = override.split(" ").filter(Boolean);
    return new ChildProcessConvertWorker({ command, args });
  }
  const repo = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  return new ChildProcessConvertWorker({
    command: "uv",
    args: ["run", "--directory", join(repo, "workers", "convert"), "citegeist-convert"],
  });
}

/**
 * Builds the full operation registry for one library: index-backed reads, notes and projects,
 * ingest with jobs, and quote cards with AI. App, CLI and MCP all use this.
 */
export function createRuntime(lib: Library, opts: RuntimeOptions = {}): Runtime {
  const registry = bindCoreOperations(new Registry(), lib);
  const backends = opts.ai?.backends ?? [new ClaudeCodeCliBackend()];
  const routing = opts.ai?.routing ?? { routing: { "*": backends[0]?.id ?? "claude-code-cli" } };
  const ai = new AiRouter(backends, routing);
  const ingest = bindIngestOperations(registry, lib, {
    resolver:
      opts.resolver ?? createResolver(opts.mailto ? { config: { mailto: opts.mailto } } : {}),
    worker: opts.worker ?? defaultWorker(),
    ...(opts.autoStart === undefined ? {} : { autoStart: opts.autoStart }),
  });
  bindCardOperations(registry, lib, { ai });
  return {
    registry,
    ingest,
    close: async () => {
      await ingest.close();
    },
  };
}
