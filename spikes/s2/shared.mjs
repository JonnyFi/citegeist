import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import Ajv from "ajv";

export const dir = path.dirname(fileURLToPath(import.meta.url));
export const LANGUAGE = "German";
export const BUDGET = 40;
const CALL_LOG = path.join(dir, "calls.log");

export const schema = {
  type: "object",
  additionalProperties: false,
  required: ["paraphrase", "core"],
  properties: {
    paraphrase: { type: "string", minLength: 20 },
    core: { type: "string", minLength: 5 },
  },
};

const validateFn = new Ajv({ strict: false }).compile(schema);
export const isValid = (v) => v != null && typeof v === "object" && validateFn(v) === true;

export const SYSTEM = `You are the highlighter of a research library app. The user marks a passage in a source. You paraphrase the passage and give a one-sentence core statement. Keep claims, numbers and hedges. Write both fields in ${LANGUAGE}, regardless of the language of the passage. Return JSON with exactly the fields "paraphrase" and "core".`;
export const userPrompt = (text) => `Passage:\n"""\n${text}\n"""`;

// Hard budget guard: every model call is logged BEFORE it is made.
export function spend(label) {
  const n = fs.existsSync(CALL_LOG) ? fs.readFileSync(CALL_LOG, "utf8").split("\n").filter(Boolean).length : 0;
  if (n >= BUDGET) throw new Error(`call budget of ${BUDGET} exhausted`);
  fs.appendFileSync(CALL_LOG, `${new Date().toISOString()} ${label}\n`);
  return n + 1;
}

export function pct(arr, p) {
  const s = [...arr].sort((a, b) => a - b);
  if (!s.length) return NaN;
  // linear interpolation between closest ranks
  const i = (s.length - 1) * p;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
}

export function summarize(name, rows) {
  const t = rows.map((r) => r.sec);
  const ok = rows.filter((r) => r.valid).length;
  return { name, n: rows.length, p50: pct(t, 0.5), p95: pct(t, 0.95), min: Math.min(...t), max: Math.max(...t), valid: `${ok}/${rows.length}` };
}

// Resident set size in MB of a pid and all descendants (ps based).
export function treeRssMb(rootPid) {
  const out = execFileSync("ps", ["-axo", "pid=,ppid=,rss="], { encoding: "utf8" });
  const rows = out.trim().split("\n").map((l) => l.trim().split(/\s+/).map(Number));
  const kids = new Map();
  for (const [pid, ppid, rss] of rows) { if (!kids.has(ppid)) kids.set(ppid, []); kids.get(ppid).push([pid, rss]); }
  const rss = new Map(rows.map(([pid, , r]) => [pid, r]));
  let total = 0; const stack = [rootPid];
  while (stack.length) { const p = stack.pop(); total += rss.get(p) ?? 0; for (const [c] of kids.get(p) ?? []) stack.push(c); }
  return total / 1024;
}
export function pidRssMb(pid) {
  try { return Number(execFileSync("ps", ["-o", "rss=", "-p", String(pid)], { encoding: "utf8" }).trim()) / 1024; } catch { return 0; }
}

// Environment with every session-specific and credential variable removed, so the
// child falls back to the subscription login in the Keychain.
export function cleanEnv() {
  const env = { ...process.env };
  for (const k of Object.keys(env)) {
    if (/^(CLAUDE|ANTHROPIC|AI_AGENT|CODEX|OPENAI)/i.test(k)) delete env[k];
  }
  return env;
}

export function writeResults(file, obj) {
  fs.writeFileSync(path.join(dir, file), JSON.stringify(obj, null, 2));
}
