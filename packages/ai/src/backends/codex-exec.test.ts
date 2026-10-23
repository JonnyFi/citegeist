import { readFileSync, writeFileSync } from "node:fs";
import { CitegeistError } from "@citegeist/schema";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { fakeRunner } from "../testing.js";
import { CodexExecBackend } from "./codex-exec.js";

const Out = z.object({ paraphrase: z.string(), core: z.string() });
const req = { task: "card.paraphrase", prompt: "P", system: "S", schema: Out };

function outFileOf(args: string[]): string {
  return args[args.indexOf("-o") + 1] as string;
}

describe("CodexExecBackend", () => {
  it("passes the schema file, ephemeral flag and reads the output file", async () => {
    let schemaSeen: unknown;
    const runner = fakeRunner((s) => {
      if (s.args[0] === "login") return { stdout: "Logged in using ChatGPT" };
      schemaSeen = JSON.parse(
        readFileSync(s.args[s.args.indexOf("--output-schema") + 1] as string, "utf8"),
      );
      writeFileSync(outFileOf(s.args), JSON.stringify({ paraphrase: "p", core: "c" }));
      return {};
    });
    const out = await new CodexExecBackend({ runner, models: { fast: "gpt-5-mini" } }).complete(
      req,
    );
    expect(out).toEqual({ paraphrase: "p", core: "c" });
    const call = runner.calls.find((c) => c.args[0] === "exec");
    expect(call?.args).toContain("--ephemeral");
    expect(call?.args).toContain("--ignore-user-config");
    expect(call?.args.slice(-2)).toEqual(["-m", "gpt-5-mini"]);
    expect(call?.stdin).toBe("S\n\nP");
    expect((schemaSeen as { required: string[] }).required).toEqual(["paraphrase", "core"]);
  });

  it("retries once on bad output and then raises AI_SCHEMA_INVALID", async () => {
    const runner = fakeRunner((s) => {
      if (s.args[0] === "login") return {};
      writeFileSync(outFileOf(s.args), "not json at all");
      return {};
    });
    await expect(new CodexExecBackend({ runner }).complete(req)).rejects.toMatchObject({
      detail: { code: "AI_SCHEMA_INVALID" },
    });
    expect(runner.calls.filter((c) => c.args[0] === "exec")).toHaveLength(2);
  });

  it("reports a logged-out Codex and a missing binary", async () => {
    const loggedOut = fakeRunner(() => ({ exitCode: 1, stdout: "Not logged in" }));
    await expect(new CodexExecBackend({ runner: loggedOut }).complete(req)).rejects.toMatchObject({
      detail: { code: "AI_CLI_LOGGED_OUT", fix: expect.stringContaining("codex login") },
    });
    const missing = fakeRunner(() => ({ exitCode: null, spawnError: "ENOENT" }));
    const err = await new CodexExecBackend({ runner: missing }).complete(req).catch((e) => e);
    expect(err).toBeInstanceOf(CitegeistError);
    expect(err.detail.code).toBe("AI_CLI_MISSING");
  });

  it("reports a timeout", async () => {
    const runner = fakeRunner((s) =>
      s.args[0] === "login" ? {} : { timedOut: true, exitCode: null },
    );
    await expect(new CodexExecBackend({ runner }).complete(req)).rejects.toMatchObject({
      detail: { code: "AI_TIMEOUT" },
    });
  });
});
