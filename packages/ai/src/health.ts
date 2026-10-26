import type { FailureKind } from "./failure.js";

/** A backend that the router skips for now. */
export interface BackendPause {
  kind: Exclude<FailureKind, "other">;
  /** Epoch milliseconds at which the router tries the backend again. */
  until: number;
}

/** How long a backend rests after a failure, when the CLI or API names no reset time. */
export const DEFAULT_PAUSE_MS: Record<BackendPause["kind"], number> = {
  limit: 30 * 60_000,
  overloaded: 2 * 60_000,
  auth: 30 * 60_000,
};

/** A reported reset time is trusted within this window, so a misread date cannot park a backend for weeks. */
const MIN_PAUSE_MS = 30_000;
const MAX_PAUSE_MS = 8 * 86_400_000;

/**
 * Which backends the router currently skips. It lives outside the router, because the router is
 * rebuilt after every settings change and the pauses must survive that. The state is in memory:
 * after a restart the first call finds out again.
 */
export class BackendHealth {
  private readonly pauses = new Map<string, BackendPause>();

  constructor(private readonly clock: () => number = Date.now) {}

  /** The current time in epoch milliseconds, from the clock this object was given. */
  now(): number {
    return this.clock();
  }

  /** Pauses `id` until `resetAt`, or for the default of the kind when no reset time is known. */
  pause(id: string, kind: BackendPause["kind"], resetAt?: Date): BackendPause {
    const at = this.clock();
    const wanted = resetAt ? resetAt.getTime() - at : DEFAULT_PAUSE_MS[kind];
    const ms = Math.min(MAX_PAUSE_MS, Math.max(MIN_PAUSE_MS, wanted));
    const pause = { kind, until: at + ms };
    this.pauses.set(id, pause);
    return pause;
  }

  /** The active pause of `id`; an expired one is dropped. */
  get(id: string): BackendPause | undefined {
    const pause = this.pauses.get(id);
    if (!pause) return undefined;
    if (pause.until <= this.clock()) {
      this.pauses.delete(id);
      return undefined;
    }
    return pause;
  }

  /** Ends the pause of `id`, or of every backend. */
  clear(id?: string): void {
    if (id === undefined) this.pauses.clear();
    else this.pauses.delete(id);
  }

  /** Ends the pauses that wait for the user (login, key), because the user may just have fixed them. */
  clearAuth(): void {
    for (const [id, pause] of this.pauses) if (pause.kind === "auth") this.pauses.delete(id);
  }
}
