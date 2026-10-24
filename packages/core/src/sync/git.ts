import { spawn } from "node:child_process";
import { CitegeistError } from "@citegeist/schema";

export interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
  /** Raw stdout, for binary file content. */
  buffer: Buffer;
}

export interface GitRunOptions {
  /** Written to stdin. */
  input?: string | Buffer;
  /** Extra environment variables for this call. */
  env?: Record<string, string>;
  /** Do not throw on a non-zero exit code. */
  allowFail?: boolean;
}

/** Variables git sets for hooks. They would point a child git at the wrong repository. */
const REPO_ENV = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_PREFIX",
  "GIT_COMMON_DIR",
  "GIT_NAMESPACE",
];

/** Settings that keep git from asking questions, signing or running remote helper commands. */
const SAFE_CONFIG = [
  "-c",
  "core.quotepath=off",
  "-c",
  "commit.gpgsign=false",
  "-c",
  "core.autocrlf=false",
  "-c",
  "protocol.ext.allow=never",
  "-c",
  "protocol.fd.allow=never",
  "-c",
  "advice.detachedHead=false",
];

export interface GitLocation {
  /** Working directory of the library. */
  cwd: string;
  /** Explicit git directory, for a repository whose .git lives outside the library. */
  gitDir?: string;
}

/** Thin wrapper around the git executable for one library. */
export class Git {
  constructor(
    readonly where: GitLocation,
    private readonly baseEnv: Record<string, string> = {},
  ) {}

  /** A copy that talks to another git directory. */
  withGitDir(gitDir: string | undefined): Git {
    return new Git(gitDir ? { ...this.where, gitDir } : { cwd: this.where.cwd }, this.baseEnv);
  }

  private args(args: string[]): string[] {
    const dir = this.where.gitDir
      ? ["--git-dir", this.where.gitDir, "--work-tree", this.where.cwd]
      : [];
    return [...SAFE_CONFIG, ...dir, ...args];
  }

  async exec(args: string[], opts: GitRunOptions = {}): Promise<GitResult> {
    const env: Record<string, string | undefined> = { ...process.env };
    for (const k of REPO_ENV) delete env[k];
    Object.assign(env, {
      GIT_TERMINAL_PROMPT: "0",
      GIT_EDITOR: "true",
      GIT_MERGE_AUTOEDIT: "no",
      LC_ALL: "C",
      LANG: "C",
      ...this.baseEnv,
      ...opts.env,
    });
    return await new Promise<GitResult>((resolve, reject) => {
      const child = spawn("git", this.args(args), {
        cwd: this.where.cwd,
        env: env as NodeJS.ProcessEnv,
        stdio: ["pipe", "pipe", "pipe"],
      });
      const out: Buffer[] = [];
      const err: Buffer[] = [];
      child.stdout.on("data", (c: Buffer) => out.push(c));
      child.stderr.on("data", (c: Buffer) => err.push(c));
      child.on("error", (e) =>
        reject(
          new CitegeistError({
            code: "GIT_NOT_AVAILABLE",
            message: `git could not be started: ${e.message}`,
            fix: "Install git (for example with `xcode-select --install`) and try again.",
            recovery: "ask-human",
            context: {},
          }),
        ),
      );
      child.on("close", (code) => {
        const buffer = Buffer.concat(out);
        const result: GitResult = {
          code: code ?? 1,
          stdout: buffer.toString("utf8"),
          stderr: Buffer.concat(err).toString("utf8"),
          buffer,
        };
        if (result.code !== 0 && !opts.allowFail) {
          reject(
            new CitegeistError({
              code: "GIT_FAILED",
              message: `git ${args.slice(0, 3).join(" ")} failed (exit ${result.code}): ${result.stderr.trim().slice(0, 500)}`,
              fix: "Check the message from git. Run `git status` in the library folder if the repository looks broken.",
              recovery: "fix-and-retry",
              sideEffects: "unknown",
              context: { args: args.slice(0, 6), exitCode: result.code },
            }),
          );
          return;
        }
        resolve(result);
      });
      if (opts.input !== undefined) child.stdin.write(opts.input);
      child.stdin.end();
    });
  }

  /** Runs git and returns trimmed stdout. Throws on failure unless `allowFail`. */
  async out(args: string[], opts: GitRunOptions = {}): Promise<string> {
    return (await this.exec(args, opts)).stdout.trim();
  }

  /** True when the command exits with 0. */
  async ok(args: string[]): Promise<boolean> {
    return (await this.exec(args, { allowFail: true })).code === 0;
  }
}

/** Environment that makes git treat path arguments as plain file names, not glob patterns. */
export const LITERAL_PATHS = { GIT_LITERAL_PATHSPECS: "1" } as const;

/** True when `git lfs` is installed. */
export async function lfsInstalled(): Promise<boolean> {
  try {
    return await new Git({ cwd: process.cwd() }).ok(["lfs", "version"]);
  } catch {
    return false;
  }
}
