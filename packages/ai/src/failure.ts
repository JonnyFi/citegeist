import { CitegeistError } from "@citegeist/schema";

/**
 * Why a backend call failed, as far as the router cares.
 *
 * - `limit`: the subscription or key has no capacity left (usage limit, rate limit, no credit).
 * - `overloaded`: the provider is short of capacity right now (HTTP 529 or 503).
 * - `auth`: the backend cannot be used until the user acts (not logged in, key invalid, CLI missing).
 * - `other`: anything else, including content errors, timeouts and cancellations.
 *
 * Only the first three make the router try the next backend.
 */
export type FailureKind = "limit" | "overloaded" | "auth" | "other";

export interface Failure {
  kind: FailureKind;
  /** When the backend says capacity returns (reset time of a usage limit, `Retry-After`). */
  resetAt?: Date | undefined;
}

/** Error codes the classifier looks at. Schema, input, cancel and timeout errors never fall back. */
const TRANSPORT_CODES = new Set([
  "AI_BACKEND_FAILED",
  "AI_CLI_LOGGED_OUT",
  "AI_CLI_MISSING",
  "AI_NOT_CONFIGURED",
]);

/** Error code that the ledger stores for a classified failure. */
export const FAILURE_CODES: Record<Exclude<FailureKind, "other">, string> = {
  limit: "AI_USAGE_LIMIT",
  overloaded: "AI_OVERLOADED",
  auth: "AI_BACKEND_UNAVAILABLE",
};

/**
 * Strings that mean "no capacity left". Recorded from the CLIs (Claude Code 2.1.307, Codex, Cursor
 * agent) and from the HTTP APIs:
 *
 * - Claude Code: `Claude AI usage limit reached|1760000000` (older, epoch seconds), `You've hit your
 *   limit · resets 3pm (Europe/Berlin)`, `5-hour limit reached ∙ resets 3pm`, `Weekly limit
 *   reached`, `Credit balance is too low`, `API Error: 429 ... rate_limit_error`.
 * - Codex: `You've hit your usage limit. Upgrade to Plus to continue ... or try again at 3:45 PM.`,
 *   `usage_limit_exceeded`, `exceeded retry limit, last status: 429 Too Many Requests`.
 * - Cursor agent: `You've hit your usage limit`, `[resource_exhausted]`.
 */
const LIMIT = new RegExp(
  [
    "usage[ _]limit",
    "limit[ _]reached",
    "(?:hit|reached|exceeded) (?:your|the) [a-z0-9 -]{0,24}limit",
    "(?:session|weekly|monthly|5-hour|five-hour) limit",
    "rate[ _-]?limit",
    "too many requests",
    "resource[_ ]exhausted",
    "insufficient[_ ]quota",
    "exceeded your current quota",
    "credit balance (?:is )?too low",
    "out of credits",
    "spend limit",
    "budget limit reached",
    "(?:http|status|error)[: ]+429\\b",
  ].join("|"),
  "i",
);

const OVERLOADED = new RegExp(
  [
    "overloaded",
    "high load",
    "at capacity",
    "service unavailable",
    "temporarily unavailable",
    "(?:http|status|error)[: ]+(?:529|503)\\b",
  ].join("|"),
  "i",
);

const AUTH = /not logged in|please run \/login|invalid api key|invalid x-api-key|unauthori[sz]ed/i;

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function offsetMs(zone: string, at: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(new Date(at));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return asUtc - Math.floor(at / 1000) * 1000;
}

/** Calendar parts of `at` as seen in `zone` (the local zone when undefined). */
function partsIn(zone: string | undefined, at: number): { y: number; m: number; d: number } {
  if (!zone) {
    const d = new Date(at);
    return { y: d.getFullYear(), m: d.getMonth(), d: d.getDate() };
  }
  const d = new Date(at + offsetMs(zone, at));
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate() };
}

/** The instant at which the wall clock of `zone` (or the local one) reads the given time. */
function wallTime(
  zone: string | undefined,
  y: number,
  m: number,
  d: number,
  h: number,
  min: number,
): number {
  if (!zone) return new Date(y, m, d, h, min).getTime();
  const guess = Date.UTC(y, m, d, h, min);
  const first = guess - offsetMs(zone, guess);
  return guess - offsetMs(zone, first);
}

const UNIT_MS: Array<[RegExp, number]> = [
  [/^d/, 86_400_000],
  [/^h/, 3_600_000],
  [/^m/, 60_000],
  [/^s/, 1000],
];

function relativeMs(text: string): number | undefined {
  let total = 0;
  let found = false;
  for (const m of text.matchAll(
    /(\d+)\s*(days?|hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b/gi,
  )) {
    const unit = UNIT_MS.find(([re]) => re.test((m[2] ?? "").toLowerCase()));
    if (!unit) continue;
    total += Number(m[1]) * unit[1];
    found = true;
  }
  return found ? total : undefined;
}

/**
 * Reads the reset time out of a limit message. Handles an epoch after a pipe (`...reached|1760000000`),
 * a wait (`Try again in 3 days 4 hours`) and a clock time with optional date and zone (`resets
 * 3:20pm (Europe/Berlin)`, `try again at Nov 5th, 2025 8:55 AM`). Anything more than 14 days out
 * or in the past is ignored, because it is more likely a misread than a reset.
 */
export function parseResetTime(text: string, now: Date = new Date()): Date | undefined {
  const nowMs = now.getTime();
  const valid = (ms: number): Date | undefined =>
    ms > nowMs && ms - nowMs <= 14 * 86_400_000 ? new Date(ms) : undefined;

  const epoch = text.match(/limit reached\s*\|\s*(\d{10,13})\b/i)?.[1];
  if (epoch) {
    const n = Number(epoch);
    return valid(epoch.length >= 13 ? n : n * 1000);
  }

  const wait = text.match(/(?:try again|retry|resets?|available again) in ([^.\n)]{1,60})/i)?.[1];
  if (wait) {
    const ms = relativeMs(wait);
    if (ms !== undefined) return valid(nowMs + ms);
  }

  const abs = text.match(
    /(?:resets?(?: at)?|will reset(?: at)?|try again at|retry at)\s+([^.\n(]{1,48})(?:\(([A-Za-z_]+(?:\/[A-Za-z_+-]+)*)\))?/i,
  );
  if (!abs?.[1]) return undefined;
  const when = abs[1];
  const time = when.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  const plain = time ? undefined : when.match(/\b(\d{1,2}):(\d{2})\b/);
  if (!time && !plain) return undefined;
  let hour = Number((time ?? plain)?.[1]);
  const minute = Number((time ?? plain)?.[2] ?? 0);
  if (time) {
    const pm = (time[3] ?? "").toLowerCase() === "pm";
    hour = (hour % 12) + (pm ? 12 : 0);
  }
  let zone: string | undefined = abs[2];
  if (zone) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: zone });
    } catch {
      zone = undefined;
    }
  }
  const month = when.match(/\b([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?/);
  const monthIndex = month ? MONTHS.indexOf((month[1] ?? "").toLowerCase()) : -1;
  const today = partsIn(zone, nowMs);
  if (month && monthIndex >= 0) {
    const year = month[3] ? Number(month[3]) : today.y;
    let at = wallTime(zone, year, monthIndex, Number(month[2]), hour, minute);
    if (!month[3] && at < nowMs - 86_400_000) {
      at = wallTime(zone, year + 1, monthIndex, Number(month[2]), hour, minute);
    }
    return valid(at);
  }
  let at = wallTime(zone, today.y, today.m, today.d, hour, minute);
  if (at <= nowMs) at += 86_400_000;
  return valid(at);
}

function statusOf(err: CitegeistError): number | undefined {
  const s = err.detail.context?.status;
  return typeof s === "number" ? s : undefined;
}

function retryAfterOf(err: CitegeistError, now: Date): Date | undefined {
  const s = err.detail.context?.retryAfterSec;
  return typeof s === "number" && s > 0 ? new Date(now.getTime() + s * 1000) : undefined;
}

/**
 * Sorts a backend error into the kinds the router acts on. Content problems (an answer that does
 * not fit the schema after the retry, a refusal), timeouts and cancellations are `other` and never
 * make the router switch backends.
 */
export function classifyFailure(err: unknown, now: Date = new Date()): Failure {
  if (!(err instanceof CitegeistError)) return { kind: "other" };
  const code = err.detail.code;
  if (!TRANSPORT_CODES.has(code)) return { kind: "other" };
  if (code === "AI_CLI_LOGGED_OUT" || code === "AI_CLI_MISSING" || code === "AI_NOT_CONFIGURED") {
    return { kind: "auth" };
  }
  const text = err.detail.message;
  const status = statusOf(err);
  if (status === 429 || LIMIT.test(text)) {
    return { kind: "limit", resetAt: retryAfterOf(err, now) ?? parseResetTime(text, now) };
  }
  if (status === 529 || status === 503 || OVERLOADED.test(text)) {
    return { kind: "overloaded", resetAt: retryAfterOf(err, now) };
  }
  if (status === 401 || status === 403 || AUTH.test(text)) return { kind: "auth" };
  return { kind: "other" };
}
