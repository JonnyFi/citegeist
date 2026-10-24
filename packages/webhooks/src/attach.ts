import type { IncomingMessage, ServerResponse } from "node:http";
import {
  type Registry,
  webhooksCreate,
  webhooksDelete,
  webhooksList,
  webhooksRotateSecret,
  webhooksSend,
  webhooksTest,
} from "@citegeist/ops";
import { createHooksHandler } from "./http.js";
import { WebhookService } from "./service.js";
import { ConnectorStore, type SecretStore } from "./store.js";
import { memoryTaskTracker, type TaskTracker } from "./tasks.js";

/** The part of a running core the webhooks need; `CoreServer` fits. */
export interface WebhooksHost {
  registry: Registry;
}

export interface AttachWebhooksOptions {
  /** Machine-local folder of the library (where index and lock live). webhooks.json goes here. */
  dir: string;
  /** Where secrets live: the macOS Keychain (`MacKeychain` from @citegeist/core) in the app. */
  secrets: SecretStore;
  /**
   * Public address of this Mac, such as https://mac.tailnet-name.ts.net (Tailscale Funnel) or
   * https://hooks.example.com (Cloudflare Tunnel). No tunnel is started; this only tells the
   * connectors where to call.
   */
  publicBaseUrl?: string | (() => string | undefined);
  /** Port of the core's HTTP server, for the local address. Pass a function if it is not known yet. */
  port?: number | (() => number | undefined);
  /** Where tasks become jobs. Default: in memory, invisible to jobs.get. Use `queueTaskTracker`. */
  tasks?: TaskTracker;
  fetch?: typeof fetch;
  log?: (message: string) => void;
}

export interface WebhooksHandle {
  service: WebhookService;
  /**
   * Call this first in the core's request listener. It answers requests under /hooks/ and returns
   * true; for any other path it returns false and does nothing.
   */
  handle(req: IncomingMessage, res: ServerResponse): Promise<boolean>;
}

const asFn = <T>(value: T | (() => T) | undefined): (() => T | undefined) =>
  typeof value === "function" ? (value as () => T) : () => value;

function validBase(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.origin + parsed.pathname.replace(/\/+$/, "")
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Binds the webhooks.* operations to the registry and returns the receiver for /hooks/<name>.
 * Call it before the oRPC router is built, so the operations appear in it.
 *
 *   const hooks = attachWebhooks(core, { dir, secrets: new MacKeychain(), port: () => core.port });
 *   // in the request listener, before the Host, Origin and token checks:
 *   if (await hooks.handle(req, res)) return;
 */
export function attachWebhooks(host: WebhooksHost, opts: AttachWebhooksOptions): WebhooksHandle {
  const publicBase = asFn(opts.publicBaseUrl);
  const port = asFn(opts.port);
  const service = new WebhookService({
    store: ConnectorStore.inDir(opts.dir),
    secrets: opts.secrets,
    registry: host.registry,
    tasks: opts.tasks ?? memoryTaskTracker(),
    publicBaseUrl: () => validBase(publicBase()),
    localBaseUrl: () => {
      const p = port();
      return p ? `http://127.0.0.1:${p}` : undefined;
    },
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
    ...(opts.log ? { log: opts.log } : {}),
  });

  host.registry
    .bind(webhooksList, async () => service.list())
    .bind(webhooksCreate, async (_ctx, input) => service.create(input))
    .bind(webhooksRotateSecret, async (_ctx, input) => service.rotateSecret(input))
    .bind(webhooksDelete, async (_ctx, input) => service.delete(input.name))
    .bind(webhooksTest, async (_ctx, input) => service.test(input.name))
    .bind(webhooksSend, async (ctx, input) => service.send(ctx.actor, input));

  return { service, handle: createHooksHandler(service) };
}
