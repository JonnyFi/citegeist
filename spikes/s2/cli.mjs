// Backend 2: plain `claude -p --output-format json --json-schema`, fresh process per call, no --bare.
// Usage: node cli.mjs [label] [extra claude flags...]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { passages } from "./passages.mjs";
import { SYSTEM, userPrompt, schema, isValid, spend, summarize, cleanEnv, writeResults } from "./shared.mjs";

const label = process.argv[2] ?? "cli";
const extra = process.argv.slice(3);
const limit = Number(process.env.S2_N ?? passages.length);
const MODEL = process.env.S2_MODEL ?? "haiku";
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "s2-cli-"));

const args = [
  "-p", "--output-format", "json",
  "--json-schema", JSON.stringify(schema),
  "--model", MODEL,
  "--tools", "",
  "--setting-sources", "",
  "--disable-slash-commands",
  "--strict-mcp-config",
  "--no-session-persistence",
  "--exclude-dynamic-system-prompt-sections",
  "--system-prompt", SYSTEM,
  ...extra,
];

function run(text) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const c = spawn("claude", args, { cwd: scratch, env: cleanEnv(), stdio: ["pipe", "pipe", "pipe"] });
    let so = "", se = "";
    c.stdout.on("data", (d) => (so += d));
    c.stderr.on("data", (d) => (se += d));
    c.on("close", (code) => resolve({ sec: (performance.now() - t0) / 1000, code, so, se }));
    c.stdin.end(userPrompt(text));
  });
}

const rows = [];
for (const p of passages.slice(0, limit)) {
  spend(`${label}-${p.id}`);
  const r = await run(p.text);
  let j; try { j = JSON.parse(r.so); } catch {}
  const o = j?.structured_output;
  const row = {
    id: p.id, lang: p.lang, sec: r.sec, code: r.code,
    valid: j?.subtype === "success" && isValid(o),
    subtype: j?.subtype, apiMs: j?.duration_api_ms, totalMs: j?.duration_ms, turns: j?.num_turns,
    cost: j?.total_cost_usd, models: j?.modelUsage ? Object.keys(j.modelUsage) : undefined,
    usage: j?.usage ? { in: j.usage.input_tokens, out: j.usage.output_tokens, cacheRead: j.usage.cache_read_input_tokens, cacheCreate: j.usage.cache_creation_input_tokens } : undefined,
    out: o, err: r.se.slice(0, 300),
  };
  rows.push(row);
  console.log(label, p.id, row.sec.toFixed(2), row.valid, row.subtype, "api", row.apiMs, "turns", row.turns, JSON.stringify(row.usage), row.models);
  writeResults(`results-${label}.json`, { args: args.filter((a) => a !== SYSTEM), rows });
}
const s = summarize(label, rows);
writeResults(`results-${label}.json`, { args: args.filter((a) => a !== SYSTEM), rows, summary: s });
console.log(JSON.stringify(s));
