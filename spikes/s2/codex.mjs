// Backend 3 fallback: `codex exec --output-schema --ephemeral`, fresh process per call.
// Not run in the recorded spike: `codex login status` reported "Not logged in" on the test machine.
// The script refuses to start without a login and does not touch the call budget in that case.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { passages } from "./passages.mjs";
import { SYSTEM, userPrompt, schema, isValid, spend, summarize, writeResults } from "./shared.mjs";

const st = spawnSync("codex", ["login", "status"], { encoding: "utf8" });
if (st.status !== 0) {
  console.error("codex is not logged in (`codex login status`: " + (st.stdout + st.stderr).trim() + "). No model call made.");
  process.exit(2);
}

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "s2-codex-"));
const schemaFile = path.join(scratch, "schema.json");
const outFile = path.join(scratch, "last.json");
fs.writeFileSync(schemaFile, JSON.stringify(schema));
const MODEL = process.env.S2_CODEX_MODEL; // unset: the account default
const args = [
  "exec", "--output-schema", schemaFile, "--ephemeral", "--skip-git-repo-check", "--ignore-user-config",
  "--ignore-rules", "-s", "read-only", "-C", scratch, "-o", outFile,
  "-c", 'model_reasoning_effort="low"',
  ...(MODEL ? ["-m", MODEL] : []),
];

function run(text) {
  return new Promise((resolve) => {
    fs.rmSync(outFile, { force: true });
    const t0 = performance.now();
    const c = spawn("codex", args, { cwd: scratch, stdio: ["pipe", "pipe", "pipe"] });
    let se = "";
    c.stderr.on("data", (d) => (se += d));
    c.stdout.on("data", () => {});
    c.on("close", (code) => resolve({ sec: (performance.now() - t0) / 1000, code, se }));
    c.stdin.end(`${SYSTEM}\n\n${userPrompt(text)}`);
  });
}

const rows = [];
for (const p of passages) {
  spend(`codex-${p.id}`);
  const r = await run(p.text);
  let o; try { o = JSON.parse(fs.readFileSync(outFile, "utf8")); } catch {}
  rows.push({ id: p.id, lang: p.lang, sec: r.sec, code: r.code, valid: isValid(o), out: o, err: r.se.slice(-200) });
  console.log("codex", p.id, r.sec.toFixed(2), rows.at(-1).valid, r.code);
  writeResults("results-codex.json", { args, rows });
}
const s = summarize("codex-exec", rows);
writeResults("results-codex.json", { args, rows, summary: s });
console.log(JSON.stringify(s));
