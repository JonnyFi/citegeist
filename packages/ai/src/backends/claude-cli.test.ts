import { readFileSync } from "node:fs";
import { CitegeistError } from "@citegeist/schema";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { claudeProbe, fakeRunner } from "../testing.js";
import { ClaudeCodeCliBackend } from "./claude-cli.js";

const recorded = readFileSync(
  new URL("./recordings/claude-p-success.json", import.meta.url),
  "utf8",
);
const Out = z.object({ paraphrase: z.string().min(1), core: z.string().min(1) });
const req = { task: "card.paraphrase", prompt: "Passage: x", system: "sys", schema: Out };

function result(structured_output: unknown, extra: object = {}): string {
  return JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    structured_output,
    ...extra,
  });
}

async function errorOf(p: Promise<unknown>): Promise<CitegeistError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(CitegeistError);
    return e as CitegeistError;
  }
  throw new Error("expected the promise to reject");
}

describe("ClaudeCodeCliBackend", () => {
  it("parses a recorded claude -p result", async () => {
    const runner = fakeRunner((s) => claudeProbe(s) ?? { stdout: recorded });
    const out = await new ClaudeCodeCliBackend({ runner }).complete(req);
    expect(out.paraphrase.length).toBeGreaterThan(20);
    expect(out.core.length).toBeGreaterThan(5);
  });

  it("uses the measured flag set in an isolated cwd and a clean env", async () => {
    const runner = fakeRunner((s) => claudeProbe(s) ?? { stdout: recorded });
    await new ClaudeCodeCliBackend({
      runner,
      env: { PATH: "/bin", CLAUDECODE: "1", CLAUDE_CODE_ENTRYPOINT: "cli", ANTHROPIC_API_KEY: "k" },
    }).complete(req);
    const call = runner.calls.find((c) => c.args.includes("-p"));
    expect(call).toBeDefined();
    const args = call?.args ?? [];
    expect(args).not.toContain("--bare");
    expect(args.slice(args.indexOf("--model"), args.indexOf("--model") + 2)).toEqual([
      "--model",
      "haiku",
    ]);
    expect(args.slice(args.indexOf("--effort"), args.indexOf("--effort") + 2)).toEqual([
      "--effort",
      "low",
    ]);
    expect(
      args.slice(args.indexOf("--setting-sources"), args.indexOf("--setting-sources") + 2),
    ).toEqual(["--setting-sources", ""]);
    expect(args).toContain("--no-session-persistence");
    expect(args[args.indexOf("--system-prompt") + 1]).toBe("sys");
    expect(JSON.parse(args[args.indexOf("--json-schema") + 1] as string).required).toEqual([
      "paraphrase",
      "core",
    ]);
    expect(call?.stdin).toBe("Passage: x");
    expect(call?.cwd).not.toBe(process.cwd());
    expect(call?.env.CLAUDECODE).toBeUndefined();
    expect(call?.env.CLAUDE_CODE_ENTRYPOINT).toBeUndefined();
    expect(call?.env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(call?.env.MAX_THINKING_TOKENS).toBe("0");
    expect(call?.env.PATH).toBe("/bin");
  });

  it("maps the smart class to a larger model and passes concrete names through", () => {
    const b = new ClaudeCodeCliBackend({ runner: fakeRunner(() => ({})) });
    expect(b.resolveModel("fast")).toBe("haiku");
    expect(b.resolveModel("smart")).toBe("sonnet");
    expect(b.resolveModel("claude-opus-9")).toBe("claude-opus-9");
  });

  it("retries once after a schema failure and returns the second answer", async () => {
    let n = 0;
    const runner = fakeRunner((s) => {
      const probe = claudeProbe(s);
      if (probe) return probe;
      n++;
      return {
        stdout:
          n === 1 ? result({ paraphrase: "only this" }) : result({ paraphrase: "a", core: "b" }),
      };
    });
    const out = await new ClaudeCodeCliBackend({ runner }).complete(req);
    expect(out).toEqual({ paraphrase: "a", core: "b" });
    const modelCalls = runner.calls.filter((c) => c.args.includes("-p"));
    expect(modelCalls).toHaveLength(2);
    expect(modelCalls[1]?.stdin).toContain("Your previous answer was rejected");
    expect(modelCalls[1]?.stdin).toContain("core");
  });

  it("raises an agent-ready error after the second schema failure", async () => {
    const runner = fakeRunner((s) => claudeProbe(s) ?? { stdout: result({ nope: true }) });
    const err = await errorOf(new ClaudeCodeCliBackend({ runner }).complete(req));
    expect(err.detail.code).toBe("AI_SCHEMA_INVALID");
    expect(err.detail.recovery).toBe("retry");
    expect(err.detail.fix).toMatch(/smart/);
    expect(runner.calls.filter((c) => c.args.includes("-p"))).toHaveLength(2);
  });

  it("falls back to the result text when structured_output is missing", async () => {
    const runner = fakeRunner(
      (s) =>
        claudeProbe(s) ?? {
          stdout: JSON.stringify({
            subtype: "success",
            is_error: false,
            result: 'Here:\n```json\n{"paraphrase":"p","core":"c"}\n```',
          }),
        },
    );
    expect(await new ClaudeCodeCliBackend({ runner }).complete(req)).toEqual({
      paraphrase: "p",
      core: "c",
    });
  });

  it("reports a timeout without retrying", async () => {
    const runner = fakeRunner((s) => claudeProbe(s) ?? { timedOut: true, exitCode: null });
    const err = await errorOf(new ClaudeCodeCliBackend({ runner, timeoutMs: 1234 }).complete(req));
    expect(err.detail.code).toBe("AI_TIMEOUT");
    expect(err.detail.recovery).toBe("retry");
    expect(err.detail.context.timeoutMs).toBe(1234);
    expect(runner.calls.filter((c) => c.args.includes("-p"))).toHaveLength(1);
  });

  it("explains a missing CLI", async () => {
    const runner = fakeRunner(() => ({ exitCode: null, spawnError: "ENOENT" }));
    const err = await errorOf(new ClaudeCodeCliBackend({ runner }).complete(req));
    expect(err.detail.code).toBe("AI_CLI_MISSING");
    expect(err.detail.recovery).toBe("do-first");
    expect(err.detail.fix).toMatch(/Install Claude Code/);
  });

  it("explains a logged-out CLI found by the preflight", async () => {
    const runner = fakeRunner((s) =>
      s.args[0] === "auth"
        ? { stdout: JSON.stringify({ loggedIn: false }) }
        : (claudeProbe(s) ?? {}),
    );
    const err = await errorOf(new ClaudeCodeCliBackend({ runner }).complete(req));
    expect(err.detail.code).toBe("AI_CLI_LOGGED_OUT");
    expect(err.detail.fix).toMatch(/claude auth login/);
    expect(runner.calls.some((c) => c.args.includes("-p"))).toBe(false);
  });

  it("explains a login that expired during a call", async () => {
    const runner = fakeRunner(
      (s) =>
        claudeProbe(s) ?? {
          exitCode: 1,
          stdout: JSON.stringify({ is_error: true, result: "Not logged in · Please run /login" }),
        },
    );
    const err = await errorOf(new ClaudeCodeCliBackend({ runner }).complete(req));
    expect(err.detail.code).toBe("AI_CLI_LOGGED_OUT");
  });

  it("rejects a CLI version other than the pin", async () => {
    const runner = fakeRunner((s) => claudeProbe(s, "2.2.0") ?? {});
    const err = await errorOf(new ClaudeCodeCliBackend({ runner }).complete(req));
    expect(err.detail.code).toBe("AI_CLI_VERSION_MISMATCH");
    expect(err.detail.fix).toContain("2.1.307");
    const ok = fakeRunner((s) => claudeProbe(s, "2.2.0") ?? { stdout: recorded });
    await expect(
      new ClaudeCodeCliBackend({ runner: ok, pinnedVersion: null }).complete(req),
    ).resolves.toBeDefined();
  });

  it("checks the setup once per instance", async () => {
    const runner = fakeRunner((s) => claudeProbe(s) ?? { stdout: recorded });
    const b = new ClaudeCodeCliBackend({ runner });
    await b.complete(req);
    await b.complete(req);
    expect(runner.calls.filter((c) => c.args[0] === "--version")).toHaveLength(1);
  });

  it("wraps a failing process in a retryable backend error", async () => {
    const runner = fakeRunner((s) => claudeProbe(s) ?? { exitCode: 1, stderr: "boom" });
    const err = await errorOf(new ClaudeCodeCliBackend({ runner }).complete(req));
    expect(err.detail.code).toBe("AI_BACKEND_FAILED");
    expect(err.message).toContain("boom");
  });

  it("has no session support yet", () => {
    const b = new ClaudeCodeCliBackend({ runner: fakeRunner(() => ({})) });
    expect(() => b.session({ system: "", mcpServers: [], cwd: "/" })).toThrow(
      /AI_SESSION_UNSUPPORTED/,
    );
  });
});
