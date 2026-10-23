import type { ProcessRunner, RunResult, RunSpec } from "./runner.js";

type Handler = (spec: RunSpec) => Partial<RunResult> | Promise<Partial<RunResult>>;

/** Scripted ProcessRunner for tests. Records every spec; `handler` decides the result per call. */
export function fakeRunner(handler: Handler): ProcessRunner & { calls: RunSpec[] } {
  const calls: RunSpec[] = [];
  const run = (async (spec: RunSpec) => {
    calls.push(spec);
    const r = await handler(spec);
    return { stdout: "", stderr: "", exitCode: 0, timedOut: false, ...r } satisfies RunResult;
  }) as ProcessRunner & { calls: RunSpec[] };
  run.calls = calls;
  return run;
}

/** Answers the `--version` and `auth status` probes of the Claude CLI like a healthy install. */
export function claudeProbe(spec: RunSpec, version = "2.1.307"): Partial<RunResult> | undefined {
  if (spec.args[0] === "--version") return { stdout: `${version} (Claude Code)\n` };
  if (spec.args[0] === "auth") return { stdout: JSON.stringify({ loggedIn: true }) };
  return undefined;
}
