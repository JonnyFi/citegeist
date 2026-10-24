import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { cardParaphrase as card } from "../tasks/card-paraphrase/index.js";
import type { AiUsage } from "../types.js";
import { ClaudeCodeCliBackend } from "./claude-cli.js";

function hasClaude(): boolean {
  try {
    execFileSync("claude", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Live check against the real CLI, so it only runs with `CITEGEIST_LIVE=1` and a logged-in
 * `claude`. It makes two small calls with a subscription. The second call repeats the prompt of
 * the first, so Claude Code's prompt cache must serve part of it: `cache_read_input_tokens` is
 * above zero. If it is not, a change to the flags or the system prompt broke caching and every
 * call now pays the full input price.
 */
describe.skipIf(!process.env.CITEGEIST_LIVE || !hasClaude())(
  "claude -p prompt cache (live)",
  () => {
    it("reads the prompt from the cache on a repeated call", async () => {
      const backend = new ClaudeCodeCliBackend({ timeoutMs: 120_000 });
      const usages: AiUsage[] = [];
      const passage =
        "Response rates dropped over the course of the 14 panel waves, from 61 percent in the first to 38 percent in the last. The dropout was selective: lower-income and less formally educated respondents left sooner.";
      for (let i = 0; i < 2; i++) {
        await backend.complete({
          task: "card.paraphrase",
          system: card.system("en"),
          prompt: card.prompt({ passage }, "en"),
          schema: card.output,
          model: "fast",
          onUsage: (u) => usages.push(u),
        });
      }
      expect(usages).toHaveLength(2);
      expect(usages[1]?.cacheReadTokens).toBeGreaterThan(0);
    }, 300_000);
  },
);
