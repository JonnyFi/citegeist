import {
  type AlertInfo,
  alertsCreate,
  alertsDelete,
  alertsList,
  alertsRunNow,
  alertsUpdate,
  type Registry,
} from "@citegeist/ops";
import { CitegeistError } from "@citegeist/schema";
import type { z } from "zod";
import type { CoreEvent } from "../lib/core";

type Alert = z.input<typeof AlertInfo>;

export interface AlertsMockState {
  alerts: Alert[];
  /** How long a run takes. */
  runMs: number;
  /** Error the next run ends with, to show a failed run. */
  runError?: string;
}

export function createAlertsMockState(over: Partial<AlertsMockState> = {}): AlertsMockState {
  return { alerts: [], runMs: 600, ...over };
}

/** Jobs of the mock core, shared so that jobs.get answers for the id alerts.runNow returns. */
export interface AlertMockJob {
  id: string;
  status: "running" | "succeeded" | "failed";
  createdAt: string;
  updatedAt: string;
  progress?: number;
  result?: unknown;
}

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
function jobId(): string {
  let out = "";
  for (let i = 0; i < 26; i++) out += CROCKFORD[Math.floor(Math.random() * CROCKFORD.length)];
  return `j_${out}`;
}

function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50) || "alert"
  );
}

/** alerts.list, create, update, delete and runNow over in-memory state. */
export function bindAlertsMock(
  registry: Registry,
  state: AlertsMockState,
  emit: (e: CoreEvent) => void = () => {},
  jobs: Map<string, AlertMockJob> = new Map(),
): Registry {
  const find = (id: string): Alert => {
    const alert = state.alerts.find((a) => a.id === id);
    if (!alert) {
      throw new CitegeistError({
        code: "ALERT_NOT_FOUND",
        message: `There is no alert with the id ${id}.`,
        fix: "Reload the list of alerts.",
        recovery: "fix-and-retry",
      });
    }
    return alert;
  };
  const view = (a: Alert): Alert => {
    const { nextRun: _drop, ...rest } = a;
    if (!a.enabled) return rest;
    const next = a.lastRun
      ? new Date(Date.parse(a.lastRun.at) + (a.intervalHours ?? 24) * 3_600_000).toISOString()
      : new Date().toISOString();
    return { ...rest, nextRun: next };
  };
  const changed = () => emit({ type: "change", path: "alerts.yaml", external: false });

  return registry
    .bind(alertsList, async (_ctx, input) => ({
      alerts: state.alerts
        .filter((a) =>
          input.project ? a.project === input.project : input.libraryOnly ? !a.project : true,
        )
        .map(view),
    }))
    .bind(alertsCreate, async (_ctx, input) => {
      let id = slug(input.name);
      for (let n = 2; state.alerts.some((a) => a.id === id); n++) id = `${slug(input.name)}-${n}`;
      const alert: Alert = {
        id,
        name: input.name,
        source: input.source,
        intervalHours: input.intervalHours ?? 24,
        limit: input.limit ?? 5,
        rank: input.rank ?? true,
        enabled: input.enabled ?? true,
        created: new Date().toISOString(),
        ...(input.project ? { project: input.project } : {}),
      };
      state.alerts.push(alert);
      changed();
      return view(alert);
    })
    .bind(alertsUpdate, async (_ctx, input) => {
      const alert = find(input.id);
      Object.assign(alert, input.patch);
      changed();
      return view(alert);
    })
    .bind(alertsDelete, async (_ctx, input) => {
      find(input.id);
      state.alerts = state.alerts.filter((a) => a.id !== input.id);
      changed();
      return { ok: true as const };
    })
    .bind(alertsRunNow, async (_ctx, input) => {
      const alert = find(input.id);
      const now = new Date().toISOString();
      const job: AlertMockJob = { id: jobId(), status: "running", createdAt: now, updatedAt: now };
      jobs.set(job.id, job);
      setTimeout(() => {
        const at = new Date().toISOString();
        job.updatedAt = at;
        if (state.runError) {
          alert.lastRun = {
            at,
            ok: false,
            fetched: 0,
            found: 0,
            added: 0,
            ranked: false,
            error: state.runError,
          };
          job.status = "failed";
        } else {
          const found = 7;
          alert.lastRun = {
            at,
            ok: true,
            fetched: 12,
            found,
            added: Math.min(alert.limit ?? 5, found),
            ranked: Boolean(alert.project && alert.rank),
          };
          job.status = "succeeded";
          job.result = alert.lastRun;
        }
        changed();
      }, state.runMs);
      return { job: job.id };
    });
}
