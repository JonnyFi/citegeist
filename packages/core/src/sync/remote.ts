import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { CitegeistError } from "@citegeist/schema";
import { freeCopyName } from "./conflicts.js";
import { type Git, LITERAL_PATHS } from "./git.js";

export interface RemoteOutcome {
  pulled: boolean;
  pushed: boolean;
  /** Paths that had a conflict; both versions are on disk (the other one as "name 2.ext"). */
  conflicts: string[];
}

const MAX_REBASE_STEPS = 100;

function remoteError(code: string, message: string, fix: string, context: Record<string, unknown>) {
  return new CitegeistError({
    code,
    message,
    fix,
    recovery: "fix-and-retry",
    sideEffects: "partial",
    context,
  });
}

/** Sets or updates the `origin` remote. */
export async function setOrigin(git: Git, url: string): Promise<void> {
  const current = await git.exec(["remote", "get-url", "origin"], { allowFail: true });
  if (current.code !== 0) await git.exec(["remote", "add", "origin", url]);
  else if (current.stdout.trim() !== url) await git.exec(["remote", "set-url", "origin", url]);
}

export async function currentBranch(git: Git): Promise<string | undefined> {
  const res = await git.exec(["symbolic-ref", "--short", "HEAD"], { allowFail: true });
  return res.code === 0 ? res.stdout.trim() : undefined;
}

async function rebaseInProgress(git: Git): Promise<boolean> {
  for (const dir of ["rebase-merge", "rebase-apply"]) {
    const p = (await git.out(["rev-parse", "--git-path", dir])).trim();
    const abs = p.startsWith("/") ? p : join(git.where.cwd, p);
    if (existsSync(abs)) return true;
  }
  return false;
}

interface Stages {
  /** Version of the remote (during a rebase, git calls it "ours"). */
  remote?: Buffer;
  /** Version of this Mac, the commit that is being replayed. */
  local?: Buffer;
}

async function readStages(git: Git, path: string): Promise<Stages> {
  const listing = await git.exec(["ls-files", "-u", "-z", "--", path], {
    env: { ...LITERAL_PATHS },
  });
  const stages = new Set<number>();
  for (const line of listing.stdout.split("\0")) {
    const m = /^\d+ [0-9a-f]+ (\d)\t/.exec(line);
    if (m) stages.add(Number(m[1]));
  }
  const out: Stages = {};
  if (stages.has(2)) out.remote = (await git.exec(["show", `:2:${path}`])).buffer;
  if (stages.has(3)) out.local = (await git.exec(["show", `:3:${path}`])).buffer;
  return out;
}

/**
 * Resolves the unmerged files of a stopped rebase: this Mac's version stays under the original
 * name, the remote version is written next to it as "name 2.ext". Both are committed, so the
 * conflict is visible on every machine until somebody resolves it.
 */
async function resolveUnmerged(git: Git, root: string): Promise<string[]> {
  const unmerged = (await git.exec(["diff", "--name-only", "--diff-filter=U", "-z"])).stdout
    .split("\0")
    .filter(Boolean);
  const conflicts: string[] = [];
  for (const path of unmerged) {
    const { remote, local } = await readStages(git, path);
    const abs = join(root, ...path.split("/"));
    mkdirSync(dirname(abs), { recursive: true });
    if (remote && local) {
      writeFileSync(abs, local);
      const copy = freeCopyName(root, path);
      writeFileSync(join(root, ...copy.split("/")), remote);
      await git.exec(["add", "--", path, copy], { env: { ...LITERAL_PATHS } });
      conflicts.push(path);
    } else if (local || remote) {
      // One side deleted the file, the other changed it: the change wins, nothing is lost.
      writeFileSync(abs, (local ?? remote) as Buffer);
      await git.exec(["add", "--", path], { env: { ...LITERAL_PATHS } });
    } else {
      await git.exec(["rm", "--quiet", "--cached", "--", path], {
        allowFail: true,
        env: { ...LITERAL_PATHS },
      });
    }
  }
  return conflicts;
}

/** Fetches, rebases the local commits onto the remote branch and writes conflicts side by side. */
async function pull(
  git: Git,
  root: string,
  branch: string,
  env: Record<string, string>,
): Promise<{ pulled: boolean; conflicts: string[] }> {
  const fetched = await git.exec(["fetch", "origin"], { allowFail: true });
  if (fetched.code !== 0) {
    throw remoteError(
      "SYNC_REMOTE_UNREACHABLE",
      `git fetch from the remote failed: ${fetched.stderr.trim().slice(0, 300)}`,
      "Check the network and the remote address with sync.status, then run sync.now again. Local changes are committed and safe.",
      { branch },
    );
  }
  const upstream = `origin/${branch}`;
  if (!(await git.ok(["rev-parse", "--verify", "--quiet", `refs/remotes/${upstream}`]))) {
    return { pulled: false, conflicts: [] };
  }
  const head = (await git.out(["rev-parse", "HEAD"])).trim();
  const remoteHead = (await git.out(["rev-parse", upstream])).trim();
  if (head === remoteHead || (await git.ok(["merge-base", "--is-ancestor", remoteHead, "HEAD"]))) {
    return { pulled: false, conflicts: [] };
  }
  const conflicts: string[] = [];
  let res = await git.exec(["rebase", upstream], { env, allowFail: true });
  for (let steps = 0; ; steps++) {
    if (!(await rebaseInProgress(git))) {
      if (res.code !== 0) {
        throw remoteError(
          "SYNC_REBASE_FAILED",
          `git rebase failed: ${res.stderr.trim().slice(0, 300)}`,
          "Run `git status` in the library folder. Local changes are committed and safe.",
          { branch },
        );
      }
      break;
    }
    if (steps >= MAX_REBASE_STEPS) {
      await git.exec(["rebase", "--abort"], { allowFail: true });
      throw remoteError(
        "SYNC_REBASE_TOO_LONG",
        "The rebase needed more than 100 steps and was aborted",
        "Sync in smaller steps: run sync.now more often, or resolve the history by hand in the library folder.",
        { branch },
      );
    }
    conflicts.push(...(await resolveUnmerged(git, root)));
    const staged = !(await git.ok(["diff", "--cached", "--quiet"]));
    res = await git.exec(["rebase", staged ? "--continue" : "--skip"], { env, allowFail: true });
  }
  return { pulled: true, conflicts: [...new Set(conflicts)] };
}

/**
 * One sync round against the git remote: pull with rebase, then push. The caller has committed
 * local changes before. A push that loses a race pulls once more and tries again.
 */
export async function syncWithRemote(
  git: Git,
  root: string,
  branch: string,
  env: Record<string, string>,
): Promise<RemoteOutcome> {
  let result = await pull(git, root, branch, env);
  let attempt = 0;
  for (;;) {
    const push = await git.exec(["push", "-u", "origin", `HEAD:refs/heads/${branch}`], {
      allowFail: true,
    });
    if (push.code === 0) return { ...result, pushed: true };
    const text = `${push.stderr}\n${push.stdout}`;
    if (/rejected|non-fast-forward|fetch first/i.test(text) && attempt++ < 2) {
      const again = await pull(git, root, branch, env);
      result = {
        pulled: result.pulled || again.pulled,
        conflicts: [...new Set([...result.conflicts, ...again.conflicts])],
      };
      continue;
    }
    if (/lfs/i.test(text)) {
      throw remoteError(
        "SYNC_LFS_UNSUPPORTED",
        `The remote refused the PDF files: ${text.trim().slice(0, 300)}`,
        'Turn git LFS off with sync.configure {lfs: "off"} or use a remote that supports git LFS (GitHub, GitLab).',
        { branch },
      );
    }
    throw remoteError(
      "SYNC_PUSH_FAILED",
      `git push failed: ${text.trim().slice(0, 300)}`,
      "Check the remote address and your access rights, then run sync.now again. Local changes are committed and safe.",
      { branch },
    );
  }
}
