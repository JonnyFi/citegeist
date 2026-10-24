import {
  type Registry,
  type SyncConflict,
  syncConfigure,
  syncNow,
  syncResolveConflict,
  syncStatus,
  webhooksCreate,
  webhooksDelete,
  webhooksList,
  webhooksRotateSecret,
  webhooksSetAuth,
  webhooksSetInboundToken,
  webhooksSetMcpAccess,
  webhooksTest,
} from "@citegeist/ops";
import { CitegeistError } from "@citegeist/schema";
import type { z } from "zod";
import type { CoreEvent } from "../lib/core";

type Transport = z.input<typeof syncConfigure.input>["transport"];
type Conflict = z.input<typeof SyncConflict>;
type Hook = z.input<typeof webhooksList.output>["webhooks"][number];

// Sync ------------------------------------------------------------------------------------------------

export interface SyncMockState {
  transport: NonNullable<Transport>;
  location: "local" | "icloud" | "dropbox";
  versioning: boolean;
  intervalMinutes: number;
  remote?: string;
  branch: string;
  uncommitted: number;
  evicted: string[];
  conflicts: Conflict[];
  lastSync?: { at: string; ok: boolean; message: string };
  /** Error `sync.now` throws, to show a failed run. */
  nowError?: string;
}

export function createSyncMockState(over: Partial<SyncMockState> = {}): SyncMockState {
  return {
    transport: "none",
    location: "local",
    versioning: false,
    intervalMinutes: 15,
    branch: "main",
    uncommitted: 0,
    evicted: [],
    conflicts: [],
    ...over,
  };
}

/** A conflict between two versions of one note, for the mock and for tests. */
export function mockConflict(path: string, over: Partial<Conflict> = {}): Conflict {
  const stem = path.replace(/\.md$/, "");
  return {
    path,
    copy: `${stem} 2.md`,
    a: { path, size: 1204, modified: "2026-10-23T18:02:00.000Z" },
    b: { path: `${stem} 2.md`, size: 1311, modified: "2026-10-24T08:41:00.000Z" },
    identical: false,
    diff: "@@ -3,2 +3,3 @@\n Autopoiesis meint Selbsterzeugung.\n-Luhmann übernimmt den Begriff von Maturana.\n+Luhmann übernimmt den Begriff von Maturana und Varela.\n+Er löst ihn von der Biologie.",
    ...over,
  };
}

/** sync.status, sync.configure, sync.now and sync.resolveConflict over in-memory state. */
export function bindSyncMock(
  registry: Registry,
  state: SyncMockState,
  emit: (e: CoreEvent) => void = () => {},
): Registry {
  const status = () => ({
    transport: state.transport,
    location: state.location,
    versioning: state.versioning,
    intervalMinutes: state.intervalMinutes,
    git: {
      initialised: state.versioning || state.transport === "git",
      gitDir: (state.versioning || state.transport === "git"
        ? state.location === "local"
          ? "embedded"
          : "separate"
        : "none") as "none" | "embedded" | "separate",
      branch: state.branch,
      head: "4e572fb",
      uncommitted: state.uncommitted,
      ...(state.remote ? { remote: { url: state.remote, ahead: 1, behind: 0 } } : {}),
      lfs: { mode: "auto" as const, installed: true, tracking: false },
    },
    evicted: [...state.evicted],
    conflicts: state.conflicts.map((c) => ({ ...c })),
    ...(state.lastSync ? { lastSync: state.lastSync } : {}),
  });

  return registry
    .bind(syncStatus, async () => status())
    .bind(syncConfigure, async (_ctx, input) => {
      if (input.transport === "git" && state.location !== "local") {
        throw new CitegeistError({
          code: "SYNC_GIT_IN_CLOUD_FOLDER",
          message: "A git remote is not possible while the library sits in iCloud or Dropbox.",
          fix: "Move the library out of the synced folder, or use that service as the sync route.",
          recovery: "ask-human",
        });
      }
      const next = input.transport ?? state.transport;
      const remote = input.remote ?? state.remote;
      if (next === "git" && !remote) {
        throw new CitegeistError({
          code: "SYNC_REMOTE_MISSING",
          message: "The transport git needs a remote URL.",
          fix: "Enter the URL of the remote repository.",
          recovery: "fix-and-retry",
        });
      }
      state.transport = next;
      if (remote) state.remote = remote;
      if (input.branch) state.branch = input.branch;
      state.intervalMinutes = input.intervalMinutes ?? state.intervalMinutes;
      state.versioning = input.versioning ?? (next !== "none" ? true : state.versioning);
      emit({ type: "change", path: "settings", external: false });
      return status();
    })
    .bind(syncNow, async () => {
      if (state.nowError) {
        throw new CitegeistError({
          code: "SYNC_FAILED",
          message: state.nowError,
          fix: "Check the connection and try again.",
          recovery: "retry",
        });
      }
      const at = new Date().toISOString();
      const message =
        state.transport === "git" ? "Pulled with rebase and pushed." : "Library is up to date.";
      state.lastSync = { at, ok: true, message };
      const commits =
        state.uncommitted > 0
          ? [
              {
                sha: "a1b2c3d",
                message: "Update from human",
                actor: "human",
                files: state.uncommitted,
              },
            ]
          : [];
      state.uncommitted = 0;
      const downloaded = [...state.evicted];
      state.evicted = [];
      return {
        transport: state.transport,
        commits,
        pulled: state.transport === "git",
        pushed: state.transport === "git",
        downloaded,
        evicted: [],
        conflicts: state.conflicts.map((c) => ({ ...c })),
        message,
      };
    })
    .bind(syncResolveConflict, async (_ctx, input) => {
      const at = state.conflicts.findIndex(
        (c) => c.path === input.path && (!input.copy || c.copy === input.copy),
      );
      const conflict = state.conflicts[at];
      if (!conflict) {
        throw new CitegeistError({
          code: "SYNC_CONFLICT_NOT_FOUND",
          message: `There is no conflict for ${input.path}.`,
          fix: "Reload the sync status.",
          recovery: "fix-and-retry",
        });
      }
      state.conflicts.splice(at, 1);
      emit({ type: "change", path: input.path, external: false });
      const kept =
        input.keep === "a"
          ? [conflict.path]
          : input.keep === "b"
            ? [conflict.path]
            : [conflict.path, conflict.copy];
      return {
        path: conflict.path,
        keep: input.keep,
        kept,
        removed: input.keep === "both" ? [] : [input.keep === "a" ? conflict.copy : conflict.path],
      };
    });
}

// Webhooks --------------------------------------------------------------------------------------------

export interface WebhooksMockState {
  /** Public address from the environment variable, which wins over the setting. */
  publicBaseUrl?: string;
  hooks: Hook[];
  /** Port of the core itself, for the inbound address while the hooks listener is not running. */
  port: number;
  /** Set to make the hooks listener report a taken port. */
  portTaken?: boolean;
  /** Secrets handed out so far, so tests can compare. */
  secrets: Record<string, string>;
  /** Tokens handed out so far: inbound bearer tokens and MCP tokens. */
  tokens: Record<string, string>;
  /** Values of the outbound auth headers; the list never returns them. */
  authValues: Record<string, string>;
}

export function createWebhooksMockState(over: Partial<WebhooksMockState> = {}): WebhooksMockState {
  return { hooks: [], port: 51234, secrets: {}, tokens: {}, authValues: {}, ...over };
}

let secretCounter = 0;
function newSecret(prefix = "whsec_"): string {
  secretCounter += 1;
  return `${prefix}${"k7Qp2xVd9LmN4aBc".repeat(2)}${secretCounter.toString().padStart(4, "0")}`;
}

/** The webhook settings the mock reads: the fixed port and the stored public address. */
export type WebhooksSettingsSource = () => { port: number; publicUrl?: string };

/** webhooks.list, create, rotateSecret, setAuth, setInboundToken, setMcpAccess, delete and test over in-memory state. */
export function bindWebhooksMock(
  registry: Registry,
  state: WebhooksMockState,
  emit: (e: CoreEvent) => void = () => {},
  settings: WebhooksSettingsSource = () => ({ port: 47321 }),
): Registry {
  const publicUrl = () => state.publicBaseUrl ?? settings().publicUrl;
  const listener = () => {
    const { port } = settings();
    if (state.hooks.length === 0) return { state: "off" as const };
    if (state.portTaken) {
      return {
        state: "error" as const,
        port,
        code: "HOOKS_PORT_IN_USE",
        detail: `Port ${port} is already in use by another program.`,
        fix: "Choose another port in Settings > Webhooks.",
      };
    }
    return { state: "listening" as const, port };
  };
  const base = () => {
    const l = listener();
    return publicUrl() ?? `http://127.0.0.1:${l.state === "listening" ? l.port : state.port}`;
  };
  const view = (hook: Hook): Hook => ({
    ...hook,
    inboundUrl: `${base()}/hooks/${hook.name}`,
    hasAuthValue: state.authValues[hook.name] !== undefined,
    hasInboundToken: state.tokens[`in:${hook.name}`] !== undefined,
  });
  const find = (name: string) => {
    const hook = state.hooks.find((h) => h.name === name);
    if (!hook) {
      throw new CitegeistError({
        code: "WEBHOOK_NOT_FOUND",
        message: `There is no connector named ${name}.`,
        fix: "Reload the list of connectors.",
        recovery: "fix-and-retry",
      });
    }
    return hook;
  };
  const changed = () => emit({ type: "change", path: "settings", external: false });

  return registry
    .bind(webhooksList, async () => {
      const url = publicUrl();
      return {
        ...(url ? { publicBaseUrl: url } : {}),
        ...(url
          ? { publicBaseUrlSource: state.publicBaseUrl ? ("env" as const) : ("settings" as const) }
          : {}),
        listener: listener(),
        webhooks: state.hooks.map(view),
      };
    })
    .bind(webhooksCreate, async (_ctx, input) => {
      if (state.hooks.some((h) => h.name === input.name)) {
        throw new CitegeistError({
          code: "WEBHOOK_EXISTS",
          message: `A connector named ${input.name} already exists.`,
          fix: "Pick another name.",
          recovery: "fix-and-retry",
        });
      }
      const hook: Hook = {
        name: input.name,
        kind: input.kind,
        ...(input.url ? { url: input.url } : {}),
        ...(input.authHeader ? { authHeader: input.authHeader } : {}),
        ...(input.mcp ? { mcpScope: input.mcp } : {}),
        inboundUrl: "",
        actor: `agent:${input.name}`,
        hasSecret: true,
        createdAt: new Date().toISOString(),
      };
      const secret = newSecret();
      state.hooks.push(hook);
      state.secrets[input.name] = secret;
      if (input.authValue) state.authValues[input.name] = input.authValue;
      let inboundToken: string | undefined;
      if (input.inboundToken) {
        inboundToken = newSecret("whtok_");
        state.tokens[`in:${input.name}`] = inboundToken;
      }
      let mcpToken: string | undefined;
      if (input.mcp) {
        mcpToken = newSecret("whmcp_");
        state.tokens[`mcp:${input.name}`] = mcpToken;
      }
      changed();
      return {
        webhook: view(hook),
        secret,
        ...(inboundToken ? { inboundToken } : {}),
        ...(mcpToken ? { mcpToken } : {}),
      };
    })
    .bind(webhooksRotateSecret, async (_ctx, input) => {
      const hook = find(input.name);
      const secret = newSecret();
      state.secrets[input.name] = secret;
      if (input.graceMinutes > 0) {
        hook.previousSecretUntil = new Date(Date.now() + input.graceMinutes * 60_000).toISOString();
      } else {
        delete hook.previousSecretUntil;
      }
      changed();
      return { webhook: view(hook), secret };
    })
    .bind(webhooksSetAuth, async (_ctx, input) => {
      const hook = find(input.name);
      if (input.authHeader && input.authValue) {
        hook.authHeader = input.authHeader;
        state.authValues[input.name] = input.authValue;
      } else {
        delete hook.authHeader;
        delete state.authValues[input.name];
      }
      changed();
      return { webhook: view(hook) };
    })
    .bind(webhooksSetInboundToken, async (_ctx, input) => {
      const hook = find(input.name);
      if (!input.enabled) {
        delete state.tokens[`in:${input.name}`];
        changed();
        return { webhook: view(hook) };
      }
      const token = newSecret("whtok_");
      state.tokens[`in:${input.name}`] = token;
      changed();
      return { webhook: view(hook), token };
    })
    .bind(webhooksSetMcpAccess, async (_ctx, input) => {
      const hook = find(input.name);
      if (!input.enabled) {
        delete hook.mcpScope;
        delete state.tokens[`mcp:${input.name}`];
        changed();
        return { webhook: view(hook) };
      }
      const token = newSecret("whmcp_");
      hook.mcpScope = input.scope;
      state.tokens[`mcp:${input.name}`] = token;
      changed();
      return { webhook: view(hook), token };
    })
    .bind(webhooksDelete, async (_ctx, input) => {
      find(input.name);
      state.hooks = state.hooks.filter((h) => h.name !== input.name);
      delete state.secrets[input.name];
      delete state.authValues[input.name];
      delete state.tokens[`in:${input.name}`];
      delete state.tokens[`mcp:${input.name}`];
      changed();
      return { ok: true as const };
    })
    .bind(webhooksTest, async (_ctx, input) => {
      const hook = find(input.name);
      if (!hook.url) return { ok: true, mode: "local" as const, latencyMs: 3 };
      if (hook.url.includes("unreachable")) {
        return {
          ok: false,
          mode: "remote" as const,
          error: "connect ECONNREFUSED: the agent does not answer",
        };
      }
      return { ok: true, mode: "remote" as const, status: 200, latencyMs: 142 };
    });
}
