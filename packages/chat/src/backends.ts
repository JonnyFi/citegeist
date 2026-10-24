import { spawn } from "node:child_process";
import { accessSync, constants, readdirSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { delimiter, dirname, extname, join } from "node:path";

/**
 * The agents the chat can talk to. Every user brings an own subscription through the official CLI
 * (D1); citegeist never handles vendor credentials. It starts an ACP adapter for the agent, passes
 * its environment through a scrub, and checks the login with the CLI's own status command.
 */

/**
 * The ACP adapters (JavaScript) ship with citegeist as dependencies of this package, pinned in
 * package.json because ACP and its adapters change quickly (research note, section 4.5). Nothing is
 * fetched at run time. The CLIs behind them (`claude`, `codex`) do not ship with the app: the
 * adapters run the ones the user installed.
 */
export const CLAUDE_ACP_PACKAGE = "@agentclientprotocol/claude-agent-acp";
export const CODEX_ACP_PACKAGE = "@agentclientprotocol/codex-acp";

/**
 * Entry script of a bundled adapter package, or undefined when it is not installed. In the
 * packaged app the package sits inside app.asar; a child process cannot run it from there, so the
 * path points into the unpacked copy (electron-builder `asarUnpack`).
 */
export function resolveAdapterEntry(pkg: string): string | undefined {
  try {
    const require = createRequire(import.meta.url);
    const manifest = require.resolve(`${pkg}/package.json`);
    const meta = require(manifest) as { bin?: string | Record<string, string> };
    const bin = typeof meta.bin === "string" ? meta.bin : Object.values(meta.bin ?? {})[0];
    if (!bin) return undefined;
    return join(dirname(manifest), bin).replace(/\.asar([\\/])/, ".asar.unpacked$1");
  } catch {
    return undefined;
  }
}

/**
 * Command line that runs a bundled adapter with the Node of this process. Inside Electron that
 * is the app binary itself, which acts as plain Node with ELECTRON_RUN_AS_NODE.
 */
export function adapterLaunch(
  pkg: string,
  extraEnv: Record<string, string> = {},
): AcpLaunch | undefined {
  const entry = resolveAdapterEntry(pkg);
  if (!entry) return undefined;
  const env = { ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {}), ...extraEnv };
  return {
    command: process.execPath,
    args: [entry],
    ...(Object.keys(env).length > 0 ? { env } : {}),
  };
}

/**
 * True when the file behind `path` is a Node script (an npm shim with a node shebang) and not a
 * native executable.
 */
export function isNodeScript(path: string): boolean {
  try {
    return /^\.(c|m)?js$/.test(extname(realpathSync(path)));
  } catch {
    return false;
  }
}

/**
 * The CLI the user installed, when the adapter can run it: a native executable, or a Node script
 * when `nodeAvailable` says a `node` can be found (a Finder-launched app has a bare PATH, which
 * `agentEnv` widens). Undefined when there is none.
 */
export function installedCli(path: string | undefined, nodeAvailable = false): string | undefined {
  if (!path) return undefined;
  try {
    realpathSync(path);
  } catch {
    return undefined;
  }
  return isNodeScript(path) && !nodeAvailable ? undefined : path;
}

/** Why the chat cannot start the CLI of a backend: not installed, or a Node script without Node. */
export function cliProblem(
  def: BackendDefinition,
  find: (name: string) => string | undefined,
): { kind: "missing" | "needs-node"; path?: string } | undefined {
  const found = find(def.cli.command);
  if (!found) return { kind: "missing" };
  if (isNodeScript(found) && !find("node")) return { kind: "needs-node", path: found };
  return undefined;
}

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
  /**
   * Extra `_meta` for `session/new`, per agent. In the sandbox (A11, "Isolierter Agent" or a
   * research job) it switches off the user's settings and the shell; otherwise it loads them.
   */
  sessionMeta?(isolated: boolean): Record<string, unknown> | undefined;
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
      "Install Claude Code (`npm install -g @anthropic-ai/claude-code`), log in with `claude auth login`, then retry.",
    login: {
      args: ["auth", "status"],
      ok: ({ stdout, code }) =>
        jsonLoggedIn(stdout) ?? (code === 0 && !/not logged in/i.test(stdout)),
      hint: "Run `claude auth login` in a terminal, then retry.",
    },
  },
  // The adapter runs the Claude Code the user installed (CLAUDE_CODE_EXECUTABLE). There is no
  // bundled copy, so without an installed `claude` it cannot start.
  launch(find) {
    const cli = installedCli(find("claude"), find("node") !== undefined);
    return cli ? adapterLaunch(CLAUDE_ACP_PACKAGE, { CLAUDE_CODE_EXECUTABLE: cli }) : undefined;
  },
  // Read by claude-agent-acp. Sandbox: no personal ~/.claude config, only the MCP servers citegeist
  // passes, no shell (research notes, section 4.5, points 3 and 4). Otherwise (A11): the settings
  // of the user and the project, which bring the user's MCP servers, plus the shell, and the
  // citegeist MCP server that the session passes.
  sessionMeta(isolated) {
    return {
      claudeCode: {
        options: isolated
          ? {
              settingSources: [],
              strictMcpConfig: true,
              disallowedTools: ["Bash", "BashOutput", "KillShell"],
            }
          : { settingSources: ["user", "project"] },
      },
    };
  },
  fallback: "claude-print",
};

export const CODEX: BackendDefinition = {
  id: "codex",
  label: "Codex",
  actor: "codex",
  cli: {
    command: "codex",
    installHint:
      "Install Codex (`npm install -g @openai/codex`), log in with `codex login`, then retry.",
    login: {
      args: ["login", "status"],
      ok: ({ stdout, stderr, code }) => code === 0 && !/not logged in/i.test(`${stdout} ${stderr}`),
      hint: "Run `codex login` in a terminal, then retry.",
    },
  },
  // Same for Codex (CODEX_PATH): the user's own binary, no bundled copy.
  launch(find) {
    const cli = installedCli(find("codex"), find("node") !== undefined);
    return cli ? adapterLaunch(CODEX_ACP_PACKAGE, { CODEX_PATH: cli }) : undefined;
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
    join(home, ".claude", "local"),
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

/**
 * Folder of the `cg` launcher inside the packaged app (Contents/Resources/bin), or undefined when
 * the process does not run from an app bundle (development, tests).
 */
export function bundledBinDir(resourcesPath: string | undefined): string | undefined {
  if (!resourcesPath) return undefined;
  const dir = join(resourcesPath, "bin");
  try {
    accessSync(join(dir, "cg"), constants.X_OK);
    return dir;
  } catch {
    return undefined;
  }
}

/**
 * Environment for spawned agents: session variables and API keys removed, PATH widened. The
 * launcher folder of the app comes first, so `cg` in the shell of an agent is the one that belongs
 * to the running app.
 */
export function agentEnv(
  extra: Record<string, string> = {},
  base: NodeJS.ProcessEnv = process.env,
  resourcesPath: string | undefined = (process as NodeJS.Process & { resourcesPath?: string })
    .resourcesPath,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(base)) {
    if (v === undefined || ENV_BLOCKLIST.test(k)) continue;
    env[k] = v;
  }
  const bundled = bundledBinDir(resourcesPath);
  env.PATH = [...new Set([...(bundled ? [bundled] : []), ...searchPath(base)])].join(delimiter);
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
    const problem = cliProblem(def, find);
    return {
      ...base,
      available: false,
      detail:
        problem?.kind === "needs-node"
          ? `${def.cli.command} at ${problem.path} is a Node script and no \`node\` was found. Install Node.js, or install ${def.label} with its native installer, then retry.`
          : "The ACP adapter was not found. Reinstall citegeist.",
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
