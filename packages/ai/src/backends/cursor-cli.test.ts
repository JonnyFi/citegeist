import { CitegeistError } from "@citegeist/schema";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { RunResult, RunSpec } from "../runner.js";
import { fakeRunner } from "../testing.js";
import { CursorCliBackend, parseCursorVersion } from "./cursor-cli.js";

const Out = z.object({ paraphrase: z.string(), core: z.string() });
const req = { task: "card.paraphrase", prompt: "P", system: "S", schema: Out };

/** Answers the `--version` and `status` probes of the Cursor CLI like a healthy, logged-in install. */
function probe(spec: RunSpec, version = "2026.05.16-0338208"): Partial<RunResult> | undefined {
  if (spec.args[0] === "--version") return { stdout: `${version}\n` };
  if (spec.args[0] === "status") {
    return { stdout: JSON.stringify({ status: "authenticated", isAuthenticated: true }) };
  }
  return undefined;
}

function reply(result: string, extra: Record<string, unknown> = {}): Partial<RunResult> {
  return {
    stdout: JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      result,
      ...extra,
    }),
  };
}

describe("CursorCliBackend", () => {
  it("runs read-only in an isolated cwd and sends system, schema and prompt on stdin", async () => {
    const runner = fakeRunner(
      (s) => probe(s) ?? reply(JSON.stringify({ paraphrase: "p", core: "c" })),
    );
    const out = await new CursorCliBackend({
      runner,
      models: { fast: "composer-2.5" },
    }).complete(req);
    expect(out).toEqual({ paraphrase: "p", core: "c" });
    const call = runner.calls.find((c) => c.args[0] === "-p");
    expect(call?.args).toEqual([
      "-p",
      "--output-format",
      "json",
      "--mode",
      "ask",
      "--trust",
      "--model",
      "composer-2.5",
    ]);
    expect(call?.cwd).toMatch(/citegeist-cursor-/);
    expect(call?.stdin?.startsWith("S\n\n")).toBe(true);
    expect(call?.stdin).toContain('"required"');
    expect(call?.stdin?.endsWith("\n\nP")).toBe(true);
  });

  it("uses auto for unset classes and passes concrete models through", () => {
    const b = new CursorCliBackend({ models: { smart: "claude-sonnet-5-thinking-high" } });
    expect(b.resolveModel("fast")).toBe("auto");
    expect(b.resolveModel("smart")).toBe("claude-sonnet-5-thinking-high");
    expect(b.resolveModel("gpt-5.2")).toBe("gpt-5.2");
  });

  it("accepts JSON wrapped in a code fence", async () => {
    const runner = fakeRunner(
      (s) => probe(s) ?? reply('```json\n{"paraphrase":"p","core":"c"}\n```'),
    );
    expect(await new CursorCliBackend({ runner }).complete(req)).toEqual({
      paraphrase: "p",
      core: "c",
    });
  });

  it("retries once on bad output and then raises AI_SCHEMA_INVALID", async () => {
    const runner = fakeRunner((s) => probe(s) ?? reply("not json at all"));
    await expect(new CursorCliBackend({ runner }).complete(req)).rejects.toMatchObject({
      detail: { code: "AI_SCHEMA_INVALID" },
    });
    const runs = runner.calls.filter((c) => c.args[0] === "-p");
    expect(runs).toHaveLength(2);
    expect(runs[1]?.stdin).toContain("Your previous answer was rejected");
  });

  it("reports a logged-out CLI with the login command, and a missing binary", async () => {
    const loggedOut = fakeRunner((s) =>
      s.args[0] === "--version"
        ? { stdout: "2026.05.16-abc" }
        : { stdout: JSON.stringify({ status: "unauthenticated", isAuthenticated: false }) },
    );
    await expect(
      new CursorCliBackend({ runner: loggedOut, env: {} }).complete(req),
    ).rejects.toMatchObject({
      detail: { code: "AI_CLI_LOGGED_OUT", fix: expect.stringContaining("agent login") },
    });
    const missing = fakeRunner(() => ({ exitCode: null, spawnError: "ENOENT" }));
    const err = await new CursorCliBackend({ runner: missing }).complete(req).catch((e) => e);
    expect(err).toBeInstanceOf(CitegeistError);
    expect(err.detail.code).toBe("AI_CLI_MISSING");
  });

  it("rejects a CLI older than the tested version", async () => {
    const runner = fakeRunner((s) => probe(s, "2026.01.02-abc") ?? {});
    await expect(new CursorCliBackend({ runner }).preflight()).rejects.toMatchObject({
      detail: { code: "AI_CLI_VERSION_MISMATCH", context: { found: "2026.01.02" } },
    });
    expect(parseCursorVersion("2026.05.16-0338208")).toBe("2026.05.16");
  });

  it("takes CURSOR_API_KEY as the login and skips the status call", async () => {
    const runner = fakeRunner(
      (s) => (s.args[0] === "--version" ? { stdout: "2026.05.16-abc" } : undefined) ?? reply("{}"),
    );
    await new CursorCliBackend({ runner, env: { CURSOR_API_KEY: "key_1" } })
      .complete({ ...req, schema: z.object({}) })
      .catch(() => undefined);
    expect(runner.calls.some((c) => c.args[0] === "status")).toBe(false);
    expect(runner.calls.find((c) => c.args[0] === "-p")?.env.CURSOR_API_KEY).toBe("key_1");
  });

  it("maps a rejected key and plain-text failures", async () => {
    const badKey = fakeRunner(
      (s) =>
        probe(s) ?? {
          exitCode: 1,
          stdout: "Warning: The provided API key is invalid.",
        },
    );
    await expect(new CursorCliBackend({ runner: badKey }).complete(req)).rejects.toMatchObject({
      detail: { code: "AI_CLI_LOGGED_OUT" },
    });
    const quota = fakeRunner(
      (s) =>
        probe(s) ?? {
          exitCode: 1,
          stderr: "S: Gemini 3.7 Flash is not included in your weekly usage",
        },
    );
    await expect(new CursorCliBackend({ runner: quota }).complete(req)).rejects.toMatchObject({
      detail: { code: "AI_BACKEND_FAILED", message: expect.stringContaining("weekly usage") },
    });
  });

  it("reports a timeout", async () => {
    const runner = fakeRunner((s) => probe(s) ?? { timedOut: true, exitCode: null });
    await expect(new CursorCliBackend({ runner }).complete(req)).rejects.toMatchObject({
      detail: { code: "AI_TIMEOUT" },
    });
  });
});
