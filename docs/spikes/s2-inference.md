# Spike S2: highlighter latency through the user's subscriptions

Date: 2026-10-23. Machine: the maintainer's Mac (Darwin 25.2.0, Node 22.23.2). Code: `spikes/s2/`. Raw per-call results: `spikes/s2/results-*.json`, call ledger: `spikes/s2/calls.log`.

Criterion from `docs/architecture.md` (Risiken und Spikes): p50 under 3 s and p95 under 6 s. Fallback if it fails: route the highlighter to an API key or a local model.

## Verdict

Fail on every measured path. The best subscription path (fresh `claude -p`, tuned flags) reaches p50 4.2 s and p95 5.2 s. Codex could not be measured because the CLI is not logged in on this machine.

## Setup

- Task: paraphrase a passage and give a one-sentence core statement, JSON `{paraphrase, core}`, language parameter German (system prompt: "Write both fields in German, regardless of the language of the passage").
- Input: 10 fixed passages in `spikes/s2/passages.mjs`, 5 German and 5 English, 96 to 121 words each. Paraphrases come out at about 120 words, so output length is close to input length (480 to 650 output tokens per call).
- Model: `haiku`, which resolves to `claude-haiku-5-5` in both the SDK and the CLI (checked with `spikes/s2/models-probe.mjs`, no model call).
- Isolation on every Claude call: no tools, no settings sources, no session persistence, scratch working directory, and all `CLAUDE*`, `ANTHROPIC*`, `OPENAI*`, `CODEX*` variables removed from the child environment so the Keychain subscription login is used (`claude auth status`: `claude.ai`).
- Validity: Ajv check against the schema (`additionalProperties: false`, both fields non-empty strings) on the structured output, plus a `success` result subtype.
- Timing: wall clock from sending the prompt to the result message (SDK warm: from `WarmQuery.query()`, the spare already initialized) or from spawn to process exit (CLI). Percentiles use linear interpolation. With n = 10, p95 is close to the maximum.
- Call budget: 40 of 40 model calls used (11 + 10 + 10 + 9). A Codex run would have needed 10 more.

Backends:

1. SDK: `@anthropic-ai/claude-agent-sdk` 0.3.309 (bundled binary 2.1.309). Cold call is a plain `query()` on a fresh process. Warm calls use `startup()` with one spare that is refilled right after each `query()`, with 1.5 s between calls. Options: `tools: []`, `settingSources: []`, `outputFormat: json_schema`, `persistSession: false`.
2. CLI: `claude -p --output-format json --json-schema <schema> --model haiku --tools "" --setting-sources "" --disable-slash-commands --strict-mcp-config --no-session-persistence --exclude-dynamic-system-prompt-sections --system-prompt <prompt>`, installed `claude` 2.1.307, fresh process per call, no `--bare`.
3. Codex: `spikes/s2/codex.mjs` (`codex exec --output-schema --ephemeral`) is written but was not run, see below.

A second pass ("tuned") adds `--effort low` and `MAX_THINKING_TOKENS=0` to the CLI, and `effort: "low"` plus `thinking: {type: "disabled"}` to the SDK. SDK and CLI calls alternate per passage in this pass, so load drift on the service hits both equally. The CLI side has 9 calls, because the budget ran out.

## Results

| Backend | n | p50 (s) | p95 (s) | Schema valid | Memory of warm process | p50 < 3 s and p95 < 6 s |
|---|---|---|---|---|---|---|
| SDK cold first call | 1 | 7.2 | n/a | 1/1 | n/a | n/a |
| SDK warm, default | 10 | 8.0 | 11.3 | 10/10 | 324 MB idle spare, 780 MB peak (active plus refilling spare) | fail |
| SDK warm, tuned | 10 | 5.6 | 9.7 | 10/10 | 330 MB idle spare, 678 MB peak | fail |
| `claude -p` fresh, default | 10 | 4.9 | 7.0 | 10/10 | none (process exits after each call) | fail |
| `claude -p` fresh, tuned | 9 | 4.2 | 5.2 | 9/9 | none | fail on p50, pass on p95 |
| Codex (`app-server` or `exec`) | 0 | not measured | not measured | not measured | not measured | not measured |

Per-call seconds, in passage order:

- SDK warm, default: 11.2, 9.4, 7.6, 10.1, 11.4, 3.8, 4.5, 5.2, 5.1, 8.3
- SDK warm, tuned: 8.1, 3.7, 5.8, 8.6, 7.8, 4.8, 10.6, 3.4, 5.4, 4.1
- CLI, default: 6.3, 4.2, 4.7, 4.2, 4.4, 6.1, 5.2, 6.5, 7.4, 4.4
- CLI, tuned: 4.7, 4.0, 4.7, 4.2, 4.1, 4.2, 5.4, 4.0, 4.8

Mean API time reported by the result message: SDK warm 8.2 s (default) and 6.9 s (tuned), CLI 4.1 s (default) and 3.1 s (tuned). `startup()` itself took 0.42 to 0.53 s per spare. Fresh `claude -p` spent about 1.2 s of wall time outside API time (spawn, initialization, process exit).

### Codex

`codex login status` prints "Not logged in" and exits 1. There is no `~/.codex/auth.json` and no `Codex Auth` Keychain item, so the premise that Codex is logged in does not hold for this machine, or the login lives somewhere this process cannot see. Logging in needs a browser and changes global CLI config, so it was not attempted. `codex.mjs` checks the login first and exits with code 2 without spending budget.

What was verified without a model call: `codex app-server generate-json-schema` shows `thread/start` (with `ephemeral`, `model`, `cwd`, `baseInstructions`) and `turn/start` (with `outputSchema`, `effort`, `model`, `input`). A warm app-server session with a structured-output turn is therefore expressible, but no JSON-RPC client was written, because it could not be tested.

## Reading the results

- Time is dominated by generating the output. A German paraphrase of a 120-word passage is about 450 to 550 tokens, and every structured-output call took 2 model turns (`num_turns: 2` in every result), so the floor is far above 3 s at the observed 150 to 190 tokens per second on the CLI path.
- Warm start saves less than expected: `startup()` costs about 0.5 s, and fresh `claude -p` pays about 1.2 s outside the API call. The hypothesis "a warm process saves at least 1 s versus cold `claude -p`" is falsified in this run, because the SDK path was slower than the CLI path.
- The SDK path was slower in API time (mean 6.9 s versus 3.1 s in the interleaved pass), and the SDK result reports about 45 times the cost per call ($0.023 versus $0.0005) while using the same model. The cause was not found and could not be probed further after the call budget ran out. Candidates: the SDK-bundled binary is 2.1.309 and the CLI is 2.1.307, the refill process starts while the call runs, and a different request shape in streaming-input mode. Treat the SDK numbers as a lower-quality measurement until this is explained.
- `effort: low` helped (CLI p50 4.9 to 4.2 s, p95 7.0 to 5.2 s), but the model reports `supportsThinkingOff: false`, so `thinking: disabled` probably has no effect on Haiku 5.5.
- The first warm SDK call reported a cost of $0.345 against about $0.023 for later calls, which looks like a one-time cache write. Subscription users do not pay per token, so this matters for rate-limit budget only.

## Recommendation

1. The architecture's fallback applies: the highlighter default for users without a key is a progress state plus the subscription path, and users who configured an API key or a local model get routing to it. A subscription-only highlighter will feel like 4 to 8 s per call.
2. As the subscription default use fresh `claude -p` with the flag set above, `--effort low` and Haiku. It was the fastest and the most consistent path (range 4.0 to 5.4 s in the tuned pass), and it needs no process pool, no 330 MB spare and no SDK dependency.
3. Keep the SDK `startup()` pool as an option, not the default, until the 2x API-time gap is explained. The check is cheap: run the same 10 passages through the SDK with `pathToClaudeCodeExecutable` set to the installed 2.1.307 binary, without the concurrent refill, and print `modelUsage` and token counts.
4. The largest untested lever is output length. A shorter paraphrase target (for example at most 60 percent of the source) cuts output tokens roughly in proportion and is the only change likely to bring p50 under 3 s on a subscription. It changes the task, so it needs a product decision.
5. Re-run Codex after `codex login`, with `node spikes/s2/codex.mjs` for `exec` (10 calls). A warm `app-server` client is the next step only if `exec` shows a promising p50.

Falsifier for this recommendation: if a re-run with the output-length cap and `--effort low` still gives a CLI p50 above 3 s, the subscription path cannot serve the highlighter interactively and it should run only in the background.

## Gotchas

- The docs this spike refers to are on branch `JonnyFi/citegeist-architecture-plan`, not on `main`.
- The SDK bundles its own `claude` binary (2.1.309 here), which can differ from the pinned CLI version. Set `pathToClaudeCodeExecutable` if both must match.
- A `WarmQuery` is single-use, so the pool has to refill after every call. Two processes are alive during a call, which gives a peak of 680 to 780 MB. A spare idles at about 330 MB here, against 230 to 260 MB in the SDK documentation.
- Structured output costs a second model turn in both SDK and CLI.
- Session-specific `CLAUDE_*` variables from a parent Claude Code session leak into children unless removed (`cleanEnv()` in `shared.mjs`).
- `--bare` is not an option, since it ignores the subscription login, and the docs say it will become the default for `-p`. The version pin and a login check in CI stay necessary.
- `claude -p` and `codex exec` results here come from one machine, one afternoon and n = 9 to 10, so p95 is effectively the slowest call. Service load changed API time by a factor of 2 between calls in the same run.
