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
  publicBaseUrl?: string;
  hooks: Hook[];
  /** Port the local receiver is "bound" to, for the inbound address. */
  port: number;
  /** Secrets handed out so far, so tests can compare. */
  secrets: Record<string, string>;
}

export function createWebhooksMockState(over: Partial<WebhooksMockState> = {}): WebhooksMockState {
  return { hooks: [], port: 51234, secrets: {}, ...over };
}

let secretCounter = 0;
function newSecret(): string {
  secretCounter += 1;
  return `whsec_${"k7Qp2xVd9LmN4aBc".repeat(2)}${secretCounter.toString().padStart(4, "0")}`;
}

/** webhooks.list, create, rotateSecret, delete and test over in-memory state. */
export function bindWebhooksMock(
  registry: Registry,
  state: WebhooksMockState,
  emit: (e: CoreEvent) => void = () => {},
): Registry {
  const base = () => state.publicBaseUrl ?? `http://127.0.0.1:${state.port}`;
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
    .bind(webhooksList, async () => ({
      ...(state.publicBaseUrl ? { publicBaseUrl: state.publicBaseUrl } : {}),
      webhooks: state.hooks.map((h) => ({ ...h, inboundUrl: `${base()}/hooks/${h.name}` })),
    }))
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
        inboundUrl: `${base()}/hooks/${input.name}`,
        actor: `agent:${input.name}`,
        hasSecret: true,
        createdAt: new Date().toISOString(),
      };
      const secret = newSecret();
      state.hooks.push(hook);
      state.secrets[input.name] = secret;
      changed();
      return { webhook: hook, secret };
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
      return { webhook: { ...hook, inboundUrl: `${base()}/hooks/${hook.name}` }, secret };
    })
    .bind(webhooksDelete, async (_ctx, input) => {
      find(input.name);
      state.hooks = state.hooks.filter((h) => h.name !== input.name);
      delete state.secrets[input.name];
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
