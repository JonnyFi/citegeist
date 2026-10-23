// Backend 1: Claude Agent SDK, cold first call (query() on a fresh process) and
// warm calls (startup() spare, refilled after each use).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { query, startup } from "@anthropic-ai/claude-agent-sdk";
import { passages } from "./passages.mjs";
import { SYSTEM, userPrompt, schema, isValid, spend, summarize, treeRssMb, pidRssMb, cleanEnv, writeResults } from "./shared.mjs";

const MODEL = process.env.S2_MODEL ?? "haiku";
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "s2-sdk-"));

const options = {
  model: MODEL,
  tools: [],
  settingSources: [],
  persistSession: false,
  systemPrompt: SYSTEM,
  outputFormat: { type: "json_schema", schema },
  cwd: scratch,
  env: cleanEnv(),
};

async function consume(q) {
  let result;
  for await (const m of q) if (m.type === "result") result = m;
  return result;
}

const own = () => pidRssMb(process.pid);
let peakChildMb = 0;
const sampler = setInterval(() => {
  peakChildMb = Math.max(peakChildMb, treeRssMb(process.pid) - own());
}, 150);

const out = { model: MODEL, cold: null, warm: [], startupSec: [], idleSpareMb: null, peakChildMb: null };

function row(p, result, sec) {
  const so = result?.structured_output;
  return {
    id: p.id, lang: p.lang, sec,
    valid: result?.subtype === "success" && isValid(so),
    subtype: result?.subtype, apiMs: result?.duration_api_ms, totalMs: result?.duration_ms,
    turns: result?.num_turns, cost: result?.total_cost_usd, out: so,
  };
}

// Cold: no pre-warmed process, query() pays spawn and initialize inline.
{
  const p = passages[0];
  spend("sdk-cold");
  const t0 = performance.now();
  const result = await consume(query({ prompt: userPrompt(p.text), options }));
  out.cold = row(p, result, (performance.now() - t0) / 1000);
  console.log("cold", out.cold.sec.toFixed(2), out.cold.valid, out.cold.subtype);
  writeResults("results-sdk.json", out);
}

// Warm: one spare is waiting; time only from query() to the result message.
let t = performance.now();
let spare = await startup({ options });
out.startupSec.push((performance.now() - t) / 1000);
for (const p of passages) {
  await new Promise((r) => setTimeout(r, 1500)); // let the spare settle, like user think time
  const idle = treeRssMb(process.pid) - own();
  out.idleSpareMb = Math.max(out.idleSpareMb ?? 0, idle);
  const warm = spare;
  spend(`sdk-warm-${p.id}`);
  const t0 = performance.now();
  const q = warm.query(userPrompt(p.text));
  // refill off the critical path (as in the recommended pattern)
  const refill = p.id < passages.length ? (async () => { const s = performance.now(); const w = await startup({ options }); out.startupSec.push((performance.now() - s) / 1000); return w; })() : null;
  const result = await consume(q);
  const sec = (performance.now() - t0) / 1000;
  out.warm.push(row(p, result, sec));
  console.log("warm", p.id, sec.toFixed(2), out.warm.at(-1).valid, result?.subtype);
  if (refill) spare = await refill;
  writeResults("results-sdk.json", out);
}
clearInterval(sampler);
out.peakChildMb = peakChildMb;
out.summary = summarize("sdk-warm", out.warm);
writeResults("results-sdk.json", out);
console.log(JSON.stringify(out.summary), "idleSpareMb", out.idleSpareMb?.toFixed(0), "peakChildMb", peakChildMb.toFixed(0));
process.exit(0);
