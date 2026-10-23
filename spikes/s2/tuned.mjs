// Tuned pass: thinking disabled, effort low. SDK warm call and fresh `claude -p` call
// are interleaved per passage so server-side load drift hits both equally.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { startup } from "@anthropic-ai/claude-agent-sdk";
import { passages } from "./passages.mjs";
import { SYSTEM, userPrompt, schema, isValid, spend, summarize, treeRssMb, pidRssMb, cleanEnv, writeResults } from "./shared.mjs";

const MODEL = "haiku";
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "s2-tuned-"));
const sdkOptions = {
  model: MODEL, tools: [], settingSources: [], persistSession: false, systemPrompt: SYSTEM,
  outputFormat: { type: "json_schema", schema }, cwd: scratch, env: cleanEnv(),
  thinking: { type: "disabled" }, effort: "low",
};
const cliArgs = [
  "-p", "--output-format", "json", "--json-schema", JSON.stringify(schema), "--model", MODEL,
  "--tools", "", "--setting-sources", "", "--disable-slash-commands", "--strict-mcp-config",
  "--no-session-persistence", "--exclude-dynamic-system-prompt-sections", "--effort", "low",
  "--system-prompt", SYSTEM,
];

function runCli(text) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const c = spawn("claude", cliArgs, { cwd: scratch, env: { ...cleanEnv(), MAX_THINKING_TOKENS: "0" }, stdio: ["pipe", "pipe", "pipe"] });
    let so = "", se = "";
    c.stdout.on("data", (d) => (so += d)); c.stderr.on("data", (d) => (se += d));
    c.on("close", (code) => resolve({ sec: (performance.now() - t0) / 1000, code, so, se }));
    c.stdin.end(userPrompt(text));
  });
}

const mk = (p, sec, subtype, valid, apiMs, turns, out, usage) => ({ id: p.id, lang: p.lang, sec, subtype, valid, apiMs, turns, out, usage });
const own = () => pidRssMb(process.pid);
let peak = 0, idle = 0;
const sampler = setInterval(() => { peak = Math.max(peak, treeRssMb(process.pid) - own()); }, 150);

const sdkRows = [], cliRows = [];
let spare = await startup({ options: sdkOptions });
for (const p of passages) {
  await new Promise((r) => setTimeout(r, 1500));
  idle = Math.max(idle, treeRssMb(process.pid) - own());
  // SDK warm
  const warm = spare;
  spend(`tuned-sdk-${p.id}`);
  let t0 = performance.now();
  const q = warm.query(userPrompt(p.text));
  const refill = p.id < passages.length ? startup({ options: sdkOptions }) : null;
  let res; for await (const m of q) if (m.type === "result") res = m;
  let sec = (performance.now() - t0) / 1000;
  sdkRows.push(mk(p, sec, res?.subtype, res?.subtype === "success" && isValid(res?.structured_output), res?.duration_api_ms, res?.num_turns, res?.structured_output,
    res?.usage && { in: res.usage.input_tokens, out: res.usage.output_tokens }));
  console.log("sdk", p.id, sec.toFixed(2), sdkRows.at(-1).valid, "api", res?.duration_api_ms, "turns", res?.num_turns, "out", res?.usage?.output_tokens);
  if (refill) spare = await refill;
  // CLI fresh process (skipped for the last passage, budget)
  if (p.id < passages.length) {
    spend(`tuned-cli-${p.id}`);
    const r = await runCli(p.text);
    let j; try { j = JSON.parse(r.so); } catch {}
    cliRows.push(mk(p, r.sec, j?.subtype, j?.subtype === "success" && isValid(j?.structured_output), j?.duration_api_ms, j?.num_turns, j?.structured_output,
      j?.usage && { in: j.usage.input_tokens, out: j.usage.output_tokens }));
    console.log("cli", p.id, r.sec.toFixed(2), cliRows.at(-1).valid, "api", j?.duration_api_ms, "turns", j?.num_turns, "out", j?.usage?.output_tokens, r.code, r.se.slice(0, 120));
  }
  writeResults("results-tuned.json", { sdkRows, cliRows, idleSpareMb: idle, peakChildMb: peak });
}
clearInterval(sampler);
const out = { sdkRows, cliRows, idleSpareMb: idle, peakChildMb: peak, sdk: summarize("sdk-warm-tuned", sdkRows), cli: summarize("cli-tuned", cliRows) };
writeResults("results-tuned.json", out);
console.log(JSON.stringify(out.sdk)); console.log(JSON.stringify(out.cli)); console.log("idle", idle.toFixed(0), "peak", peak.toFixed(0));
process.exit(0);
