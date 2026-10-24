import { CitegeistError } from "@citegeist/schema";

type Recovery = "retry" | "fix-and-retry" | "do-first" | "ask-human";

function make(
  code: string,
  recovery: Recovery,
  message: string,
  fix: string,
  context: Record<string, unknown> = {},
): CitegeistError {
  return new CitegeistError({ code, message, fix, recovery, sideEffects: "none", context });
}

/** Cut long process output so errors stay readable and never carry whole prompts. */
export function snippet(text: string, max = 400): string {
  const t = text.trim();
  return t.length <= max ? t : `${t.slice(0, max)}...`;
}

export const aiErrors = {
  cliMissing: (cli: "claude" | "codex" | "agent", installHint: string) =>
    make(
      "AI_CLI_MISSING",
      "do-first",
      `The \`${cli}\` command was not found on PATH or in the usual install folders (~/.local/bin, ~/.claude/local, /opt/homebrew/bin, /usr/local/bin).`,
      installHint,
      { cli },
    ),
  cliLoggedOut: (cli: "claude" | "codex" | "agent", loginCommand: string, detail = "") =>
    make(
      "AI_CLI_LOGGED_OUT",
      "do-first",
      `The \`${cli}\` CLI is not logged in.${detail ? ` ${snippet(detail, 200)}` : ""}`,
      `Run \`${loginCommand}\` in a terminal, then retry.`,
      { cli },
    ),
  cliVersion: (
    cli: "claude" | "agent",
    found: string,
    pinned: string,
    upgradeHint = `Install ${cli} ${pinned} (for example \`npm install -g @anthropic-ai/claude-code@${pinned}\`), or set the backend option pinnedVersion to ${found} after testing it.`,
  ) =>
    make(
      "AI_CLI_VERSION_MISMATCH",
      "fix-and-retry",
      `Found ${cli} ${found}, but citegeist is pinned to ${pinned}.`,
      upgradeHint,
      { cli, found, pinned },
    ),
  timeout: (backend: string, task: string, timeoutMs: number) =>
    make(
      "AI_TIMEOUT",
      "retry",
      `Backend ${backend} did not answer task ${task} within ${timeoutMs} ms.`,
      "Retry the task. If it keeps timing out, raise timeoutMs for this backend or route the task to a faster backend.",
      { backend, task, timeoutMs },
    ),
  backendFailed: (backend: string, task: string, detail: string, context = {}) =>
    make(
      "AI_BACKEND_FAILED",
      "retry",
      `Backend ${backend} failed on task ${task}: ${snippet(detail)}`,
      "Retry the task. If the error persists, check the backend setup or route the task to another backend.",
      { backend, task, ...context },
    ),
  schemaInvalid: (backend: string, task: string, issues: string, attempts: number) =>
    make(
      "AI_SCHEMA_INVALID",
      "retry",
      `Backend ${backend} returned output for task ${task} that does not match the schema after ${attempts} attempts: ${snippet(issues)}`,
      "Retry the task, or route it to a larger model class (smart) in the AI settings.",
      { backend, task, attempts },
    ),
  notConfigured: (what: string, fix: string) =>
    make("AI_NOT_CONFIGURED", "fix-and-retry", `${what} is not configured.`, fix, { what }),
  sessionUnsupported: (backend: string) =>
    make(
      "AI_SESSION_UNSUPPORTED",
      "ask-human",
      `Backend ${backend} does not support agent sessions yet.`,
      "Use complete() for single-shot tasks. Agent sessions arrive with the research workstream.",
      { backend },
    ),
  unknownTask: (name: string, known: string[]) =>
    make(
      "AI_UNKNOWN_TASK",
      "fix-and-retry",
      `No AI task named ${name}.`,
      `Use one of: ${known.join(", ")}.`,
      {
        name,
      },
    ),
  unknownBackend: (id: string, known: string[]) =>
    make(
      "AI_UNKNOWN_BACKEND",
      "fix-and-retry",
      `No backend registered under id ${id}.`,
      `Register it or change the routing setting. Registered: ${known.join(", ") || "none"}.`,
      { id },
    ),
  inputInvalid: (task: string, issues: string) =>
    make(
      "AI_INPUT_INVALID",
      "fix-and-retry",
      `Input for task ${task} does not match its schema: ${snippet(issues)}`,
      "Fix the input fields named in the message and call again.",
      { task },
    ),
};
