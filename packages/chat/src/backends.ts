import { spawn } from "node:child_process";
import { accessSync, constants, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

/**
 * The agents the chat can talk to. Every user brings an own subscription through the official CLI
 * (D1); citegeist never handles vendor credentials. It starts an ACP adapter for the agent, passes
 * its environment through a scrub, and checks the login with the CLI's own status command.
 */

/** Adapter versions, pinned because ACP and its adapters change quickly (research note, section 4.5). */
export const CLAUDE_ACP_PACKAGE = "@agentclientprotocol/claude-agent-acp@0.95.0";
export const CODEX_ACP_PACKAGE = "@agentclientprotocol/codex-acp@2.2.2";

export interface AcpLaunch {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface LoginCheck {
  args: string[];
  /** True when the command output says the user is logged in. */
  ok(out: { stdout: string; stderr: string; code: number | null }): boolean;
  /** What to tell the user when it is not. */
  hint: string;
}

export interface BackendDefinition {
  /** Stable id used in settings and in `chat.start`. */
  id: string;
  label: string;
  /** Provenance name: everything this agent writes carries `agent:<actor>`. */
  actor: string;
  /** Command line of the official CLI, used for the installation and login check. */
  cli: { command: string; login?: LoginCheck; installHint: string };
  /** Command that speaks ACP on stdio. Undefined when it cannot be found. */
  launch(find: (name: string) => string | undefined): AcpLaunch | undefined;
  /** Extra `_meta` for `session/new`: per-agent knobs for isolation (no user settings, no shell). */
  sessionMeta?: Record<string, unknown>;
  /** Streaming fallback through the CLI itself when the ACP adapter cannot start. */
  fallback?: "claude-print";
}

const jsonLoggedIn = (stdout: string): boolean | undefined => {
  try {
    const parsed = JSON.parse(stdout) as { loggedIn?: unknown };
    return typeof parsed.loggedIn === "boolean" ? parsed.loggedIn : undefined;
  } catch {
    return undefined;
  }
};

export const CLAUDE_CODE: BackendDefinition = {
  id: "claude-code",
  label: "Claude Code",
  actor: "claude-code",
  cli: {
    command: "claude",
    installHint:
      "Install Claude Code (`npm install -g @anthropic-ai/claude-code`), run `claude` once to log in, then retry.",
    login: {
      args: ["auth", "status"],
      ok: ({ stdout, code }) =>
        jsonLoggedIn(stdout) ?? (code === 0 && !/not logged in/i.test(stdout)),
      hint: "Run `claude auth login` in a terminal, then retry.",
    },
  },
  launch(find) {
    const npx = find("npx");
    return npx ? { command: npx, args: ["-y", CLAUDE_ACP_PACKAGE] } : undefined;
  },
  // Read by claude-agent-acp: no personal ~/.claude config, only the MCP servers citegeist passes,
  // no shell (the research notes, section 4.5, points 3 and 4).
  sessionMeta: {
    claudeCode: {
      options: {
        settingSources: [],
        strictMcpConfig: true,
        disallowedTools: ["Bash", "BashOutput", "KillShell"],
      },
    },
  },
  fallback: "claude-print",
};

export const CODEX: BackendDefinition = {
  id: "codex",
  label: "Codex",
  actor: "codex",
  cli: {
    command: "codex",
    installHint: "Install Codex (`npm install -g @openai/codex`), run `codex login`, then retry.",
    login: {
      args: ["login", "status"],
      ok: ({ stdout, stderr, code }) => code === 0 && !/not logged in/i.test(`${stdout} ${stderr}`),
      hint: "Run `codex login` in a terminal, then retry.",
    },
  },
  launch(find) {
    const npx = find("npx");
    return npx ? { command: npx, args: ["-y", CODEX_ACP_PACKAGE] } : undefined;
  },
};

export const CURSOR: BackendDefinition = {
  id: "cursor",
  label: "Cursor",
  actor: "cursor",
  cli: {
    command: "agent",
    installHint: "Install the Cursor CLI (https://cursor.com/cli), run `agent login`, then retry.",
    login: {
      args: ["status", "--format", "json"],
      ok: ({ stdout, code }) => {
        const flag = jsonLoggedIn(stdout);
        if (flag !== undefined) return flag;
        return code === 0 && !/not logged in|unauthenticated/i.test(stdout);
      },
      hint: "Run `agent login` in a terminal, then retry.",
    },
  },
  launch(find) {
    const agent = find("agent") ?? find("cursor-agent");
    return agent ? { command: agent, args: ["acp"] } : undefined;
  },
};

export const DEFAULT_BACKENDS: readonly BackendDefinition[] = [CLAUDE_CODE, CODEX, CURSOR];

// Environment and executables -------------------------------------------------------------------

/** Variables of a parent agent session, and API keys that would override the subscription login. */
const ENV_BLOCKLIST = /^(CLAUDECODE$|CLAUDE_CODE_|ANTHROPIC_|AI_AGENT|CODEX_(SANDBOX|THREAD|CI))/i;

/** Directories where GUI apps do not look but CLIs live (a Finder-launched app has a bare PATH). */
export function extraSearchDirs(): string[] {
  const home = homedir();
  const dirs = [
    join(home, ".local", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    join(home, ".npm-global", "bin"),
    join(home, ".volta", "bin"),
    join(home, ".bun", "bin"),
    join(home, ".cargo", "bin"),
    join(home, ".cursor", "bin"),
  ];
  try {
    const nvm = join(home, ".nvm", "versions", "node");
    for (const v of readdirSync(nvm).sort().reverse()) dirs.push(join(nvm, v, "bin"));
  } catch {
    // no nvm
  }
  return dirs;
}

export function searchPath(env: NodeJS.ProcessEnv = process.env): string[] {
  const own = (env.PATH ?? "").split(delimiter).filter(Boolean);
  return [...new Set([...own, ...extraSearchDirs()])];
}

export function findExecutable(name: string, dirs: string[] = searchPath()): string | undefined {
  for (const dir of dirs) {
    const candidate = join(dir, name);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // not here
    }
  }
  return undefined;
}

/** Environment for spawned agents: session variables and API keys removed, PATH widened. */
export function agentEnv(
  extra: Record<string, string> = {},
  base: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(base)) {
    if (v === undefined || ENV_BLOCKLIST.test(k)) continue;
    env[k] = v;
  }
  env.PATH = searchPath(base).join(delimiter);
  return { ...env, ...extra };
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  code: number | null;
  /** Spawn error code such as ENOENT. */
  error?: string;
  timedOut: boolean;
}

/** Runs a short command and collects its output. Never rejects. */
export function runCommand(
  command: string,
  args: string[],
  opts: { env?: Record<string, string>; cwd?: string; timeoutMs?: number } = {},
): Promise<CommandResult> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const done = (r: CommandResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };
    const child = spawn(command, args, {
      cwd: opts.cwd ?? process.cwd(),
      env: opts.env ?? agentEnv(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, opts.timeoutMs ?? 10_000);
    child.stdout.on("data", (d) => {
      stdout += d;
    });
    child.stderr.on("data", (d) => {
      stderr += d;
    });
    child.on("error", (err: NodeJS.ErrnoException) =>
      done({ stdout, stderr, code: null, error: err.code ?? err.message, timedOut }),
    );
    child.on("close", (code) => done({ stdout, stderr, code, timedOut }));
  });
}

export interface BackendStatus {
  id: string;
  label: string;
  available: boolean;
  detail?: string;
}

/** Is the CLI installed and logged in? One status call, cached by the caller. */
export async function checkBackend(
  def: BackendDefinition,
  find: (name: string) => string | undefined = findExecutable,
): Promise<BackendStatus> {
  const base = { id: def.id, label: def.label };
  const cli = find(def.cli.command) ?? (def.id === "cursor" ? find("cursor-agent") : undefined);
  if (!cli) {
    return { ...base, available: false, detail: `Not installed. ${def.cli.installHint}` };
  }
  if (!def.launch(find) && !def.fallback) {
    return {
      ...base,
      available: false,
      detail:
        "Node.js (npx) was not found, which starts the ACP adapter. Install Node.js 22 or later.",
    };
  }
  if (def.cli.login) {
    const out = await runCommand(cli, def.cli.login.args);
    if (!def.cli.login.ok(out)) {
      return { ...base, available: false, detail: `Not logged in. ${def.cli.login.hint}` };
    }
  }
  return { ...base, available: true, detail: "ready" };
}
