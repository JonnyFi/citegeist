import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { UsageTotals } from "@citegeist/ops";
import Database from "better-sqlite3";

/** One AI call or agent turn. */
export interface UsageEntry {
  /** `task` for the AI tasks of the router, `chat` for conversations, `research` for research jobs. */
  source: "task" | "chat" | "research";
  /** Task name such as `card.paraphrase`, or the source for agent turns. */
  task: string;
  backend: string;
  /** Concrete model; empty when the backend does not say. */
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** List price in US dollars, when the backend reported one. */
  costUsd?: number | undefined;
  ms: number;
  ok: boolean;
  /** Error code of a failed call. */
  error?: string | undefined;
  /** Who asked for it: `human`, `agent:<name>` or `system`. */
  actor: string;
  session?: string | undefined;
  job?: string | undefined;
  at?: Date | undefined;
}

export interface UsageSummary {
  days: number;
  since: string;
  totals: UsageTotals;
  byDay: Array<UsageTotals & { day: string }>;
  byTask: Array<UsageTotals & { task: string }>;
  byBackend: Array<UsageTotals & { backend: string }>;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS ai_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  day TEXT NOT NULL,
  source TEXT NOT NULL,
  task TEXT NOT NULL,
  backend TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  cache_read_tokens INTEGER NOT NULL,
  cache_write_tokens INTEGER NOT NULL,
  cost_usd REAL,
  ms INTEGER NOT NULL,
  ok INTEGER NOT NULL,
  error TEXT,
  actor TEXT NOT NULL,
  session TEXT,
  job TEXT
);
CREATE INDEX IF NOT EXISTS ai_usage_at ON ai_usage(at);
`;

const AGGREGATE = `
  COUNT(*) AS calls,
  SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END) AS failed,
  SUM(input_tokens) AS inputTokens,
  SUM(output_tokens) AS outputTokens,
  SUM(cache_read_tokens) AS cacheReadTokens,
  SUM(cache_write_tokens) AS cacheWriteTokens,
  COALESCE(SUM(cost_usd), 0) AS costUsd,
  SUM(CASE WHEN cost_usd IS NULL THEN 0 ELSE 1 END) AS pricedCalls,
  SUM(ms) AS ms`;

type Aggregate = UsageTotals;

const EMPTY: UsageTotals = {
  calls: 0,
  failed: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  costUsd: 0,
  pricedCalls: 0,
  ms: 0,
};

/**
 * The usage ledger: one row per AI call or agent turn in the `ai_usage` table of state.sqlite.
 * That file sits in the machine-local folder, so the ledger is never synced and never leaves the
 * Mac. It shares the file with the job queue, which opens it as well; WAL mode lets both write.
 */
export class UsageLedger {
  private readonly db: Database.Database;

  constructor(
    dbPath: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("busy_timeout = 5000");
    this.db.exec(SCHEMA);
  }

  record(entry: UsageEntry): void {
    const at = (entry.at ?? this.now()).toISOString();
    this.db
      .prepare(
        `INSERT INTO ai_usage(at, day, source, task, backend, model, input_tokens, output_tokens,
          cache_read_tokens, cache_write_tokens, cost_usd, ms, ok, error, actor, session, job)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        at,
        at.slice(0, 10),
        entry.source,
        entry.task,
        entry.backend,
        entry.model,
        Math.round(entry.inputTokens),
        Math.round(entry.outputTokens),
        Math.round(entry.cacheReadTokens),
        Math.round(entry.cacheWriteTokens),
        entry.costUsd ?? null,
        Math.round(entry.ms),
        entry.ok ? 1 : 0,
        entry.error ?? null,
        entry.actor,
        entry.session ?? null,
        entry.job ?? null,
      );
  }

  /** Everything recorded in the last `days` days. Days are UTC days. */
  summary(days: number): UsageSummary {
    const since = new Date(this.now().getTime() - days * 86_400_000).toISOString();
    const group = <K extends string>(column: string, key: K) =>
      (
        this.db
          .prepare(
            `SELECT ${column} AS ${key}, ${AGGREGATE} FROM ai_usage WHERE at >= ? GROUP BY ${column}
             ORDER BY ${column === "day" ? "day" : "calls DESC"}`,
          )
          .all(since) as Array<Aggregate & Record<K, string>>
      ).map((row) => ({ ...row, ...clean(row) }));
    const totals = this.db.prepare(`SELECT ${AGGREGATE} FROM ai_usage WHERE at >= ?`).get(since) as
      | Aggregate
      | undefined;
    return {
      days,
      since,
      totals: totals && totals.calls > 0 ? clean(totals) : { ...EMPTY },
      byDay: group("day", "day"),
      byTask: group("task", "task"),
      byBackend: group("backend", "backend"),
    };
  }

  close(): void {
    this.db.close();
  }
}

/** SUM over no rows is NULL and floating point sums carry noise; make the numbers plain. */
function clean(row: Aggregate): UsageTotals {
  return {
    calls: row.calls ?? 0,
    failed: row.failed ?? 0,
    inputTokens: row.inputTokens ?? 0,
    outputTokens: row.outputTokens ?? 0,
    cacheReadTokens: row.cacheReadTokens ?? 0,
    cacheWriteTokens: row.cacheWriteTokens ?? 0,
    costUsd: Math.round((row.costUsd ?? 0) * 1e8) / 1e8,
    pricedCalls: row.pricedCalls ?? 0,
    ms: row.ms ?? 0,
  };
}
