import { chmodSync, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { nodeRunner, type ProcessRunner } from "@citegeist/ai";
import { extendedPath, findExecutable } from "../settings/executables.js";
import { downloadChecked, type Progress, setupError, type ToolNames } from "./download.js";

/**
 * The Typst release `typst.setup` downloads (docs/decisions/0002-writing-in-markdown-with-pandoc.md).
 * Typst is Apache-2.0 and runs as a separate process that Pandoc starts for a PDF. Like Pandoc,
 * the release is pinned by URL and sha256; a new version means a new pin in this file.
 */
export const PINNED_TYPST = {
  version: "0.15.1",
  url: "https://github.com/typst/typst/releases/download/v0.15.1/typst-aarch64-apple-darwin.tar.xz",
  sha256: "48f62ed034aa3a7978309579ac6ca00045e2ef0da73114e8af27cfd8e74dc05a",
  sizeMb: 14,
  /** Top-level folder inside the archive. */
  folder: "typst-aarch64-apple-darwin",
} as const;

export type TypstSpec = {
  version: string;
  url: string;
  sha256: string;
  sizeMb: number;
  folder: string;
};

/** Pandoc 3.12 writes Typst that compiles from this version on (it polyfills what 0.15 added). */
export const MIN_TYPST: readonly [number, number] = [0, 11];

export interface TypstLocation {
  path: string;
  version: string;
  source: "path" | "managed";
}

export interface TypstLookup {
  location?: TypstLocation;
  rejected: Array<{ path: string; version?: string; reason: string }>;
}

export interface LocateTypstOptions {
  /** Machine-local base directory; the managed copy lives in `<localBase>/typst/<version>/`. */
  localBase: string;
  runner?: ProcessRunner;
  spec?: TypstSpec;
  pathEnv?: string | undefined;
  home?: string | undefined;
  exists?: (path: string) => boolean;
}

const NAMES: ToolNames = {
  label: "Typst",
  prefix: "TYPST",
  brew: "typst",
  pinFile: "typst.ts",
};

/** Where `typst.setup` puts the pinned release. */
export function managedTypstPath(localBase: string, spec: TypstSpec = PINNED_TYPST): string {
  return join(localBase, "typst", spec.version, "typst");
}

/** `0.15.1` from `typst 0.15.1 (9dfd3a08)`. */
export function parseTypstVersion(output: string): string | undefined {
  return /^typst\s+(\d+(?:\.\d+)+)/m.exec(output)?.[1];
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
  const version = parseTypstVersion(out.stdout);
  return version ? { version } : { error: "no version in the output of --version" };
}

/**
 * Finds a usable Typst: the copy citegeist downloaded first, because its version is the one the
 * PDF export is tested with, then one on `PATH` or in Homebrew.
 */
export async function locateTypst(opts: LocateTypstOptions): Promise<TypstLookup> {
  const runner = opts.runner ?? nodeRunner;
  const exists = opts.exists ?? existsSync;
  const rejected: TypstLookup["rejected"] = [];
  const candidates: Array<{ path: string; source: TypstLocation["source"] }> = [];
  const managed = managedTypstPath(opts.localBase, opts.spec);
  if (exists(managed)) candidates.push({ path: managed, source: "managed" });
  const found = findExecutable("typst", {
    pathEnv: opts.pathEnv,
    ...(opts.home ? { home: opts.home } : {}),
    exists,
  });
  if (found && found !== managed) candidates.push({ path: found, source: "path" });

  for (const c of candidates) {
    const seen = await probe(runner, c.path);
    if (!seen.version) {
      rejected.push({ path: c.path, reason: seen.error ?? "does not run" });
    } else if (!atLeast(seen.version, MIN_TYPST)) {
      rejected.push({
        path: c.path,
        version: seen.version,
        reason: `version ${seen.version} is older than ${MIN_TYPST.join(".")}`,
      });
    } else {
      return { location: { path: c.path, version: seen.version, source: c.source }, rejected };
    }
  }
  return { rejected };
}

/** The pinned release is built for macOS on Apple silicon only. */
export function typstInstallable(
  platform: string = process.platform,
  arch: string = process.arch,
): boolean {
  return platform === "darwin" && arch === "arm64";
}

export interface PdfEngine {
  /** `typst`, or the name of a LaTeX engine. */
  name: string;
  path: string;
}

/**
 * Typst whenever it is there, because its layout and the Pandoc arguments for it are the ones
 * citegeist tests. A LaTeX engine is the fallback for a Mac that has one and no Typst.
 */
export function choosePdfEngine(found: {
  typst?: Pick<TypstLocation, "path"> | undefined;
  latex?: PdfEngine | undefined;
}): PdfEngine | undefined {
  if (found.typst) return { name: "typst", path: found.typst.path };
  return found.latex;
}

export interface TypstInstallDeps {
  localBase: string;
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  runner?: ProcessRunner;
  spec?: TypstSpec;
  platform?: string;
  arch?: string;
  tar?: string;
  xattr?: string;
}

/**
 * Downloads the pinned Typst release into `<localBase>/typst/<version>/`, checks the sha256
 * before anything is unpacked, removes the quarantine flag and runs `typst --version` once to
 * confirm it works.
 */
export async function installTypst(
  ctx: Progress,
  deps: TypstInstallDeps,
): Promise<{ path: string; version: string }> {
  const spec = deps.spec ?? PINNED_TYPST;
  if (!typstInstallable(deps.platform, deps.arch)) {
    throw setupError(
      "TYPST_NOT_INSTALLABLE",
      "citegeist downloads Typst only for macOS on Apple silicon.",
      "Install Typst yourself (https://github.com/typst/typst/releases, on macOS `brew install typst`), then export again.",
      "do-first",
    );
  }
  const runner = deps.runner ?? nodeRunner;
  const doFetch = deps.fetch ?? ((url, init) => fetch(url, init));
  const base = join(deps.localBase, "typst");
  mkdirSync(base, { recursive: true });
  // work folders start with a dot, so a crashed download never counts as a version
  const work = mkdtempSync(join(base, ".download-"));
  try {
    const archive = join(work, "typst.tar.xz");
    await downloadChecked(ctx, doFetch, spec, archive, NAMES);

    ctx.progress(0.85, "Unpacking Typst");
    const extracted = join(work, "unpacked");
    mkdirSync(extracted);
    const untar = await runner({
      command: deps.tar ?? "/usr/bin/tar",
      args: ["-xf", archive, "-C", extracted],
      cwd: "/",
      env: { PATH: extendedPath() },
      timeoutMs: 120_000,
    });
    if (untar.exitCode !== 0) {
      throw setupError(
        "TYPST_UNPACK_FAILED",
        `Unpacking failed: ${(untar.stderr || untar.spawnError || "tar exited with an error").trim().slice(-300)}`,
        "Run the Typst setup again.",
        "fix-and-retry",
      );
    }
    const target = join(base, spec.version);
    rmSync(target, { recursive: true, force: true });
    renameSync(join(extracted, spec.folder), target);
    const binary = managedTypstPath(deps.localBase, spec);
    chmodSync(binary, 0o755);
    // Downloads through Node carry no quarantine flag; this only guards against one that came
    // from elsewhere. A failure changes nothing, so the result is not checked.
    await runner({
      command: deps.xattr ?? "/usr/bin/xattr",
      args: ["-dr", "com.apple.quarantine", target],
      cwd: "/",
      env: { PATH: extendedPath() },
      timeoutMs: 30_000,
    });

    ctx.progress(0.95, "Checking Typst");
    const checked = await probe(runner, binary);
    if (!checked.version) {
      rmSync(target, { recursive: true, force: true });
      throw setupError(
        "TYPST_UNUSABLE",
        `The downloaded Typst does not run (${checked.error ?? "unknown reason"}).`,
        "Install Typst yourself (`brew install typst`).",
        "do-first",
      );
    }
    ctx.progress(1, `Typst ${checked.version} ready`);
    return { path: binary, version: checked.version };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
