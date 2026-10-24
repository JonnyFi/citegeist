import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { AlertDef, type AlertRun } from "@citegeist/ops";
import { parse, stringify } from "yaml";
import { writeFileAtomic } from "../fsutil.js";
import { problem } from "../ingest/items.js";
import type { Library } from "../library.js";

/** The alerts of the library that belong to no project. */
export const ROOT_ALERTS = "alerts.yaml";

export function alertsRel(project?: string): string {
  return project ? `projects/${project}/alerts.yaml` : ROOT_ALERTS;
}

/** One entry of the file. An entry that does not validate is kept as it is, so a rewrite never loses it. */
export interface AlertEntry {
  raw: unknown;
  def?: AlertDef;
}

export interface AlertsFile {
  rel: string;
  project?: string;
  entries: AlertEntry[];
}

/** Reads one alerts file. A missing file is an empty one. */
export function readAlertsFile(lib: Library, project?: string): AlertsFile {
  const rel = alertsRel(project);
  const base = { rel, ...(project ? { project } : {}) };
  const abs = lib.paths.abs(rel);
  if (!existsSync(abs)) return { ...base, entries: [] };
  let data: unknown;
  try {
    data = parse(readFileSync(abs, "utf8"));
  } catch (err) {
    throw problem(
      "ALERTS_FILE_INVALID",
      `${rel} is not valid YAML: ${err instanceof Error ? err.message : String(err)}`,
      `Fix ${rel} in a text editor, or delete it.`,
      { path: rel },
    );
  }
  if (data === null || data === undefined) return { ...base, entries: [] };
  const list = (data as { alerts?: unknown }).alerts;
  if (list === undefined || list === null) return { ...base, entries: [] };
  if (!Array.isArray(list)) {
    throw problem(
      "ALERTS_FILE_INVALID",
      `${rel} needs a list under the key 'alerts'`,
      `Write 'alerts:' followed by a list of alerts in ${rel}.`,
      { path: rel },
    );
  }
  return {
    ...base,
    entries: list.map((raw): AlertEntry => {
      const parsed = AlertDef.safeParse(raw);
      return parsed.success ? { raw, def: parsed.data } : { raw };
    }),
  };
}

export function writeAlertsFile(lib: Library, file: AlertsFile): void {
  const abs = lib.paths.abs(file.rel);
  if (file.entries.length === 0) {
    // An empty file is noise in the folder; deleting the last alert removes it.
    rmSync(abs, { force: true });
    return;
  }
  writeFileAtomic(abs, stringify({ alerts: file.entries.map((e) => e.def ?? e.raw) }));
}

/** The files that can hold alerts: the root file and the file of every project. */
export function alertFiles(lib: Library): AlertsFile[] {
  const files = [readAlertsFile(lib)];
  const dir = lib.paths.projectsDir;
  if (!existsSync(dir)) return files;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    if (!existsSync(join(dir, e.name, "alerts.yaml"))) continue;
    files.push(readAlertsFile(lib, e.name));
  }
  return files;
}

// Run state ------------------------------------------------------------------------------------

/** What the machine knows about one alert: the last run, where to continue and what was proposed. */
export interface AlertState {
  lastRun?: AlertRun;
  /** ISO time of the last successful run. The next window starts here. */
  cursor?: string;
  /** Identifiers of works the alert already proposed, so a rejected work does not come back. */
  seen: string[];
}

/** Largest number of identifiers remembered per alert. */
export const SEEN_LIMIT = 1000;

/** Run state in the machine-local folder, because it differs from machine to machine. */
export class AlertStateStore {
  private data: Record<string, AlertState> | undefined;

  constructor(private readonly path: string) {}

  private load(): Record<string, AlertState> {
    if (this.data) return this.data;
    try {
      const raw = JSON.parse(readFileSync(this.path, "utf8")) as Record<string, AlertState>;
      this.data = raw && typeof raw === "object" ? raw : {};
    } catch {
      this.data = {};
    }
    return this.data;
  }

  get(id: string): AlertState {
    const s = this.load()[id];
    return {
      ...(s?.lastRun ? { lastRun: s.lastRun } : {}),
      ...(s?.cursor ? { cursor: s.cursor } : {}),
      seen: [...(s?.seen ?? [])],
    };
  }

  set(id: string, state: AlertState): void {
    const data = this.load();
    data[id] = { ...state, seen: state.seen.slice(-SEEN_LIMIT) };
    writeFileAtomic(this.path, `${JSON.stringify(data)}\n`);
  }

  delete(id: string): void {
    const data = this.load();
    if (!(id in data)) return;
    delete data[id];
    writeFileAtomic(this.path, `${JSON.stringify(data)}\n`);
  }
}
