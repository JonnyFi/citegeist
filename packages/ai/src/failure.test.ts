import { CitegeistError } from "@citegeist/schema";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ClaudeCodeCliBackend } from "./backends/claude-cli.js";
import { CodexExecBackend } from "./backends/codex-exec.js";
import { CursorCliBackend } from "./backends/cursor-cli.js";
import { OpenAiCompatBackend } from "./backends/openai-http.js";
import { aiErrors } from "./errors.js";
import { classifyFailure, parseResetTime } from "./failure.js";
import type { RunResult, RunSpec } from "./runner.js";
import { claudeProbe, fakeRunner } from "./testing.js";

const Out = z.object({ paraphrase: z.string(), core: z.string() });
const req = { task: "card.paraphrase", prompt: "P", system: "S", schema: Out };
// 12:00 UTC on a Tuesday. Europe/Berlin is on winter time (UTC+1) from 25 October 2026.
const NOW = new Date("2026-10-27T12:00:00Z");

async function failureOf(run: () => Promise<unknown>) {
  try {
    await run();
  } catch (e) {
    expect(e).toBeInstanceOf(CitegeistError);
    return e as CitegeistError;
  }
  throw new Error("expected a rejection");
}

function claude(out: Partial<RunResult>) {
  const runner = fakeRunner((s) => claudeProbe(s) ?? out);
  return new ClaudeCodeCliBackend({ runner });
}

function claudeResult(result: string): Partial<RunResult> {
  return {
    exitCode: 1,
    stdout: JSON.stringify({ type: "result", subtype: "success", is_error: true, result }),
  };
}

function codex(stderr: string) {
  const runner = fakeRunner((s) =>
    s.args[0] === "login" ? { stdout: "Logged in" } : { exitCode: 1, stderr },
  );
  return new CodexExecBackend({ runner });
}

function cursor(out: Partial<RunResult>) {
  const runner = fakeRunner((s: RunSpec) => {
    if (s.args[0] === "--version") return { stdout: "2026.05.16-0338208\n" };
    if (s.args[0] === "status") return { stdout: JSON.stringify({ isAuthenticated: true }) };
    return out;
  });
  return new CursorCliBackend({ runner });
}

/**
 * Messages the CLIs print when a subscription is used up. The Claude and Codex strings are taken
 * from the shipped binaries (Claude Code 2.1.307, Codex CLI), the Cursor ones from Cursor's
 * documentation and forum reports, because the agent binary only holds the server's message.
 */
describe("classifyFailure per backend", () => {
  const limitCases: Array<[string, () => Promise<unknown>]> = [
    [
      "claude: old usage limit with epoch",
      () => claude(claudeResult("Claude AI usage limit reached|1793102400")).complete(req),
    ],
    [
      "claude: hit your limit with clock time",
      () =>
        claude(claudeResult("You've hit your limit · resets 3pm (Europe/Berlin)")).complete(req),
    ],
    [
      "claude: 5-hour limit",
      () => claude(claudeResult("5-hour limit reached ∙ resets 5pm")).complete(req),
    ],
    [
      "claude: weekly limit",
      () => claude(claudeResult("Weekly limit reached ∙ resets Oct 30, 9am")).complete(req),
    ],
    [
      "claude: credit balance",
      () => claude(claudeResult("Credit balance is too low")).complete(req),
    ],
    [
      "claude: API 429",
      () =>
        claude(
          claudeResult(
            'API Error: 429 {"type":"error","error":{"type":"rate_limit_error","message":"Number of request tokens has exceeded your per-minute rate limit"}}',
          ),
        ).complete(req),
    ],
    [
      "codex: usage limit with clock time",
      () =>
        codex(
          "ERROR: You've hit your usage limit. Upgrade to Plus to continue using Codex (https://chatgpt.com/explore/plus), or try again at 3:45 PM.",
        ).complete(req),
    ],
    ["codex: error code", () => codex("ERROR: usage_limit_exceeded").complete(req)],
    [
      "codex: retry limit with 429",
      () =>
        codex("stream error: exceeded retry limit, last status: 429 Too Many Requests").complete(
          req,
        ),
    ],
    [
      "cursor: usage limit",
      () =>
        cursor(
          claudeResult("You've hit your usage limit. Switch to Auto or upgrade your plan."),
        ).complete(req),
    ],
    [
      "cursor: resource_exhausted on stderr",
      () =>
        cursor({ exitCode: 1, stderr: "ConnectError: [resource_exhausted] Error" }).complete(req),
    ],
  ];

  for (const [name, run] of limitCases) {
    it(`${name} is a limit`, async () => {
      expect(classifyFailure(await failureOf(run), NOW).kind).toBe("limit");
    });
  }

  it("claude: reads the epoch after the pipe as the reset time", async () => {
    const err = await failureOf(() =>
      claude(claudeResult("Claude AI usage limit reached|1793102400")).complete(req),
    );
    const f = classifyFailure(err, new Date(1793100000_000));
    expect(f.resetAt?.toISOString()).toBe(new Date(1793102400_000).toISOString());
  });

  const overloaded: Array<[string, () => Promise<unknown>]> = [
    [
      "claude: 529",
      () =>
        claude(
          claudeResult(
            'API Error: 529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}',
          ),
        ).complete(req),
    ],
    ["claude: API overloaded", () => claude(claudeResult("API overloaded")).complete(req)],
    [
      "codex: high load",
      () => codex("ERROR: Codex is currently experiencing high load.").complete(req),
    ],
    ["codex: server_overloaded", () => codex("ERROR: server_overloaded").complete(req)],
    [
      "cursor: 503",
      () => cursor({ exitCode: 1, stderr: "HTTP 503 Service Unavailable" }).complete(req),
    ],
  ];

  for (const [name, run] of overloaded) {
    it(`${name} is overloaded`, async () => {
      expect(classifyFailure(await failureOf(run), NOW).kind).toBe("overloaded");
    });
  }

  it("a logged-out CLI and a missing CLI are auth", async () => {
    const loggedOut = await failureOf(() =>
      claude(claudeResult("Not logged in · Please run /login")).complete(req),
    );
    expect(classifyFailure(loggedOut).kind).toBe("auth");
    expect(classifyFailure(aiErrors.cliMissing("codex", "install it")).kind).toBe("auth");
    expect(classifyFailure(aiErrors.notConfigured("API key", "set it")).kind).toBe("auth");
  });

  it("HTTP status and Retry-After come from the context", async () => {
    const http = (status: number, headers: Record<string, string> = {}) =>
      new OpenAiCompatBackend({
        id: "openrouter",
        baseUrl: "https://example.test/v1",
        apiKey: "k",
        models: { fast: "f", smart: "s" },
        fetch: async () => new Response("{}", { status, headers }),
      }).complete(req);
    const limited = classifyFailure(await failureOf(() => http(429, { "retry-after": "90" })), NOW);
    expect(limited.kind).toBe("limit");
    expect(limited.resetAt?.getTime()).toBe(NOW.getTime() + 90_000);
    expect(classifyFailure(await failureOf(() => http(529)), NOW).kind).toBe("overloaded");
    expect(classifyFailure(await failureOf(() => http(503)), NOW).kind).toBe("overloaded");
    expect(classifyFailure(await failureOf(() => http(401)), NOW).kind).toBe("auth");
    expect(classifyFailure(await failureOf(() => http(500)), NOW).kind).toBe("other");
  });

  it("content errors, timeouts and cancellations never fall back", async () => {
    const invalid = await failureOf(() =>
      claude({
        stdout: JSON.stringify({ type: "result", is_error: false, structured_output: { x: 1 } }),
      }).complete(req),
    );
    expect(invalid.detail.code).toBe("AI_SCHEMA_INVALID");
    expect(classifyFailure(invalid).kind).toBe("other");
    expect(classifyFailure(aiErrors.timeout("claude-code-cli", "t", 1000)).kind).toBe("other");
    expect(classifyFailure(aiErrors.cancelled("claude-code-cli", "t")).kind).toBe("other");
    expect(classifyFailure(new Error("429 rate limit")).kind).toBe("other");
  });

  it("a refusal that mentions no limit is a content error", async () => {
    const refusal = await failureOf(() =>
      claude(claudeResult("I can't help with that request.")).complete(req),
    );
    expect(classifyFailure(refusal).kind).toBe("other");
  });
});

describe("parseResetTime", () => {
  it("reads a clock time in a named zone", () => {
    // 3pm in Berlin is 14:00 UTC and still ahead of 12:00 UTC.
    expect(parseResetTime("resets 3pm (Europe/Berlin)", NOW)?.toISOString()).toBe(
      "2026-10-27T14:00:00.000Z",
    );
  });

  it("rolls a clock time that has passed over to the next day", () => {
    expect(parseResetTime("resets 1pm (Europe/Berlin)", NOW)?.toISOString()).toBe(
      "2026-10-28T12:00:00.000Z",
    );
  });

  it("reads minutes and PM in the Codex form", () => {
    const at = parseResetTime("or try again at 3:45 PM.", NOW);
    expect(at).toBeDefined();
    expect(at?.getHours()).toBe(15);
    expect(at?.getMinutes()).toBe(45);
  });

  it("reads a date with time", () => {
    expect(
      parseResetTime("Weekly limit reached ∙ resets Oct 30, 9am (UTC)", NOW)?.toISOString(),
    ).toBe("2026-10-30T09:00:00.000Z");
    expect(parseResetTime("try again at Oct 29th, 2026 8:55 AM (UTC)", NOW)?.toISOString()).toBe(
      "2026-10-29T08:55:00.000Z",
    );
  });

  it("reads a wait", () => {
    expect(parseResetTime("Try again in 3 days 4 hours 12 minutes.", NOW)?.toISOString()).toBe(
      "2026-10-30T16:12:00.000Z",
    );
  });

  it("reads epoch seconds after the pipe and drops dates in the past or far away", () => {
    expect(parseResetTime("usage limit reached|1793102400", new Date(1793100000_000))).toEqual(
      new Date(1793102400_000),
    );
    expect(parseResetTime("usage limit reached|1000000000", NOW)).toBeUndefined();
    expect(parseResetTime("try again in 40 days", NOW)).toBeUndefined();
    expect(parseResetTime("no time in here", NOW)).toBeUndefined();
  });
});
