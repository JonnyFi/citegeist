import {
  type Registry,
  syncConfigure,
  syncNow,
  syncResolveConflict,
  syncStatus,
} from "@citegeist/ops";
import type { Library } from "../library.js";
import { runAs, SyncService, type SyncServiceOptions } from "./service.js";

export interface BindSyncOptions extends SyncServiceOptions {
  /**
   * Wrap `registry.call` so that library changes made while an operation runs are committed as
   * the actor of that operation ("agent:<name>: <operations>"). Default true.
   */
  trackActors?: boolean;
}

/**
 * Binds sync.status, sync.configure, sync.now and sync.resolveConflict, and returns the service.
 * The caller starts it with `await service.start()` and stops it with `service.close()`.
 */
export function bindSyncOperations(
  registry: Registry,
  lib: Library,
  opts: BindSyncOptions = {},
): SyncService {
  const { trackActors = true, ...serviceOptions } = opts;
  const service = new SyncService(lib, serviceOptions);
  registry
    .bind(syncStatus, async () => service.status())
    .bind(syncConfigure, async (_ctx, input) => service.configure(input))
    .bind(syncNow, async (_ctx, input) => service.sync(input))
    .bind(syncResolveConflict, async (ctx, input) => service.resolveConflict(ctx.actor, input));
  if (trackActors) {
    const call = registry.call.bind(registry);
    registry.call = (name, ctx, input) =>
      name.startsWith("sync.")
        ? call(name, ctx, input)
        : runAs(ctx.actor, name, () => call(name, ctx, input));
  }
  return service;
}
