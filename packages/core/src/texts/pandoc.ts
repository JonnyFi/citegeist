import { createHash } from "node:crypto";
import {
  chmodSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { nodeRunner, type ProcessRunner } from "@citegeist/ai";
import { CitegeistError } from "@citegeist/schema";
import { extendedPath, findExecutable } from "../settings/executables.js";

/**
 * The Pandoc release `pandoc.setup` downloads (D20). Pandoc is GPL-2.0, so citegeist never links
 * it: the app runs it as a separate process. Like the GROBID download, the release is pinned by
 * URL and sha256; a new version means a new pin in this file.
 */
export const PINNED_PANDOC = {
  version: "3.12.1",
  url: "https://github.com/jgm/pandoc/releases/download/3.12.1/pandoc-3.12.1-arm64-macOS.zip",
  sha256: "c2146cf33a583f3ac93eccddf1bb662371d5cfcce1aad1c87ad860cca1435d46",
  sizeMb: 42,
  /** Top-level folder inside the archive. */
  folder: "pandoc-3.12.1-arm64",
} as const;

export type PandocSpec = {
  version: string;
  url: string;
  sha256: string;
  sizeMb: number;
  folder: string;
};

/** `--citeproc` is built in from this version on. */
export const MIN_PANDOC: readonly [number, number] = [2, 11];

/** PDF engines in the order citegeist prefers them: Unicode-capable LaTeX engines first. */
export const PDF_ENGINES = ["xelatex", "lualatex", "tectonic", "pdflatex", "typst"] as const;

export interface PandocLocation {
  path: string;
  version: string;
  source: "path" | "managed";
}

export interface PandocLookup {
  location?: PandocLocation;
  /** Candidates that exist but cannot be used, with the reason. */
  rejected: Array<{ path: string; version?: string; reason: string }>;
}

export interface LocateOptions {
  /** Machine-local base directory; the managed copy lives in `<localBase>/pandoc/<version>/`. */
  localBase: string;
  runner?: ProcessRunner;
  spec?: PandocSpec;
  pathEnv?: string | undefined;
  home?: string | undefined;
  exists?: (path: string) => boolean;
}

/** Where `pandoc.setup` puts the pinned release. */
export function managedPandocPath(localBase: string, spec: PandocSpec = PINNED_PANDOC): string {
  return join(localBase, "pandoc", spec.version, "bin", "pandoc");
}

/** `3.12.1` from `pandoc 3.12.1` (first line of `pandoc --version`). */
export function parsePandocVersion(output: string): string | undefined {
  return /^pandoc\S*\s+(\d+(?:\.\d+)+)/m.exec(output)?.[1];
}

function atLeast(version: string, min: readonly [number, number]): boolean {
  const [major = 0, minor = 0] = version.split(".").map((n) => Number.parseInt(n, 10));
  return major > min[0] || (major === min[0] && minor >= min[1]);
}

async function probe(
  runner: ProcessRunner,
  path: string,
): Promise<{ version?: string; error?: string }> {
  const out = await runner({
    command: path,
    args: ["--version"],
    cwd: "/",
    env: { PATH: extendedPath() },
    timeoutMs: 15_000,
  });
  if (out.spawnError || out.exitCode !== 0) {
    return { error: out.spawnError ?? `exit code ${out.exitCode ?? "none"}` };
  }
  const version = parsePandocVersion(out.stdout);
  return version ? { version } : { error: "no version in the output of --version" };
}

/**
 * Finds a usable Pandoc: first the one on `PATH` or in the Homebrew and other usual install
 * directories, then the copy citegeist downloaded. Versions below 2.11 are rejected because they
 * lack `--citeproc`.
 */
export async function locatePandoc(opts: LocateOptions): Promise<PandocLookup> {
  const runner = opts.runner ?? nodeRunner;
  const exists = opts.exists ?? existsSync;
  const rejected: PandocLookup["rejected"] = [];
  const candidates: Array<{ path: string; source: PandocLocation["source"] }> = [];
  const found = findExecutable("pandoc", {
    pathEnv: opts.pathEnv,
    ...(opts.home ? { home: opts.home } : {}),
    exists,
  });
  if (found) candidates.push({ path: found, source: "path" });
  const managed = managedPandocPath(opts.localBase, opts.spec);
  if (exists(managed)) candidates.push({ path: managed, source: "managed" });

  for (const c of candidates) {
    const seen = await probe(runner, c.path);
    if (!seen.version) {
      rejected.push({ path: c.path, reason: seen.error ?? "does not run" });
    } else if (!atLeast(seen.version, MIN_PANDOC)) {
      rejected.push({
        path: c.path,
        version: seen.version,
        reason: `version ${seen.version} is older than ${MIN_PANDOC.join(".")}`,
      });
    } else {
      return { location: { path: c.path, version: seen.version, source: c.source }, rejected };
    }
  }
  return { rejected };
}

/** The first PDF engine that is installed, in the order of `PDF_ENGINES`. */
export function findPdfEngine(
  opts: {
    pathEnv?: string | undefined;
    home?: string | undefined;
    exists?: (p: string) => boolean;
  } = {},
): { name: string; path: string } | undefined {
  for (const name of PDF_ENGINES) {
    const path = findExecutable(name, {
      pathEnv: opts.pathEnv,
      ...(opts.home ? { home: opts.home } : {}),
      ...(opts.exists ? { exists: opts.exists } : {}),
    });
    if (path) return { name, path };
  }
  return undefined;
}

export function pandocInstallable(
  platform: string = process.platform,
  arch: string = process.arch,
): boolean {
  return platform === "darwin" && arch === "arm64";
}

function setupError(
  code: string,
  message: string,
  fix: string,
  recovery: "do-first" | "fix-and-retry",
): CitegeistError {
  // A job error carries only code and message, so the fix travels inside the message too.
  return new CitegeistError({
    code,
    message: `${message} ${fix}`,
    fix,
    recovery,
    sideEffects: "none",
  });
}

export interface InstallDeps {
  localBase: string;
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  runner?: ProcessRunner;
  spec?: PandocSpec;
  platform?: string;
  arch?: string;
  unzip?: string;
}

export interface InstallProgress {
  progress(value: number, message?: string): void;
  signal?: AbortSignal | undefined;
}

/**
 * Downloads the pinned Pandoc release into `<localBase>/pandoc/<version>/`, checks the sha256
 * before anything is unpacked, and runs `pandoc --version` once to confirm it works.
 */
export async function installPandoc(
  ctx: InstallProgress,
  deps: InstallDeps,
): Promise<{ path: string; version: string }> {
  const spec = deps.spec ?? PINNED_PANDOC;
  if (!pandocInstallable(deps.platform, deps.arch)) {
    throw setupError(
      "PANDOC_NOT_INSTALLABLE",
      "citegeist downloads Pandoc only for macOS on Apple silicon.",
      "Install Pandoc yourself (https://pandoc.org/installing.html, on macOS `brew install pandoc`), then export again.",
      "do-first",
    );
  }
  const runner = deps.runner ?? nodeRunner;
  const doFetch = deps.fetch ?? ((url, init) => fetch(url, init));
  const base = join(deps.localBase, "pandoc");
  mkdirSync(base, { recursive: true });
  const work = mkdtempSync(join(base, ".download-"));
  try {
    ctx.progress(0.02, `Downloading Pandoc ${spec.version} (about ${spec.sizeMb} MB)`);
    let response: Response;
    try {
      response = await doFetch(spec.url, { ...(ctx.signal ? { signal: ctx.signal } : {}) });
    } catch (err) {
      throw setupError(
        "PANDOC_DOWNLOAD_FAILED",
        `The download of Pandoc failed: ${err instanceof Error ? err.message : String(err)}.`,
        "Check the network connection and run the Pandoc setup again.",
        "fix-and-retry",
      );
    }
    if (!response.ok || !response.body) {
      throw setupError(
        "PANDOC_DOWNLOAD_FAILED",
        `GitHub answered ${response.status} for ${spec.url}.`,
        "Run the Pandoc setup again later, or install Pandoc yourself (`brew install pandoc`).",
        "fix-and-retry",
      );
    }
    const zip = join(work, "pandoc.zip");
    const hash = createHash("sha256");
    const total = Number(response.headers.get("content-length")) || spec.sizeMb * 1024 * 1024;
    let received = 0;
    const body = Readable.fromWeb(response.body as import("node:stream/web").ReadableStream);
    body.on("data", (chunk: Buffer) => {
      hash.update(chunk);
      received += chunk.length;
      ctx.progress(0.02 + 0.8 * Math.min(received / total, 1));
    });
    await pipeline(body, createWriteStream(zip));
    const digest = hash.digest("hex");
    if (digest !== spec.sha256) {
      throw setupError(
        "PANDOC_CHECKSUM",
        `The download has sha256 ${digest}, expected ${spec.sha256}.`,
        "Run the Pandoc setup again. If it fails again, the pinned release changed and the pin in packages/core/src/texts/pandoc.ts needs an update.",
        "fix-and-retry",
      );
    }

    ctx.progress(0.85, "Unpacking Pandoc");
    const extracted = join(work, "unpacked");
    const unzip = await runner({
      command: deps.unzip ?? "/usr/bin/unzip",
      args: ["-q", "-o", zip, "-d", extracted],
      cwd: "/",
      env: { PATH: extendedPath() },
      timeoutMs: 120_000,
    });
    if (unzip.exitCode !== 0) {
      throw setupError(
        "PANDOC_UNPACK_FAILED",
        `Unpacking failed: ${(unzip.stderr || unzip.spawnError || "unzip exited with an error").trim().slice(-300)}`,
        "Run the Pandoc setup again.",
        "fix-and-retry",
      );
    }
    const target = join(base, spec.version);
    rmSync(target, { recursive: true, force: true });
    renameSync(join(extracted, spec.folder), target);
    const binary = managedPandocPath(deps.localBase, spec);
    chmodSync(binary, 0o755);

    ctx.progress(0.95, "Checking Pandoc");
    const checked = await probe(runner, binary);
    if (!checked.version) {
      rmSync(target, { recursive: true, force: true });
      throw setupError(
        "PANDOC_UNUSABLE",
        `The downloaded Pandoc does not run (${checked.error ?? "unknown reason"}).`,
        "Install Pandoc yourself (`brew install pandoc`).",
        "do-first",
      );
    }
    ctx.progress(1, `Pandoc ${checked.version} ready`);
    return { path: binary, version: checked.version };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
