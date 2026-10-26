import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";
import type { ProcessRunner, RunResult, RunSpec } from "@citegeist/ai";
import { Registry } from "@citegeist/ops";
import { CitegeistError } from "@citegeist/schema";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JobQueue } from "../jobs/queue.js";
import { Library } from "../library.js";
import { cleanTmpDirs, itemData, tmpDir } from "../test-helpers.js";
import {
  biblatexStyle,
  buildPandocArgs,
  LATEX_LAYOUT,
  referenceTitle,
  TYPST_LAYOUT,
} from "./args.js";
import { bindTextsOperations } from "./ops.js";
import {
  findPdfEngine,
  installPandoc,
  locatePandoc,
  managedPandocPath,
  PINNED_PANDOC,
  parsePandocVersion,
} from "./pandoc.js";
import {
  choosePdfEngine,
  installTypst,
  locateTypst,
  managedTypstPath,
  PINNED_TYPST,
  parseTypstVersion,
} from "./typst.js";
import { createZip } from "./zip.js";

type Handler = (spec: RunSpec) => Partial<RunResult>;

/** Scripted ProcessRunner: records every call, `handler` decides the result. */
function fakeRunner(handler: Handler): ProcessRunner & { calls: RunSpec[] } {
  const calls: RunSpec[] = [];
  const run = (async (spec: RunSpec) => {
    calls.push(spec);
    return { stdout: "", stderr: "", exitCode: 0, timedOut: false, ...handler(spec) };
  }) as ProcessRunner & { calls: RunSpec[] };
  run.calls = calls;
  return run;
}

const open: Library[] = [];
afterEach(async () => {
  for (const l of open.splice(0)) await l.close();
  cleanTmpDirs();
});

/** Reads the entries of a ZIP written by createZip. */
function unzip(buf: Buffer): Record<string, string> {
  const out: Record<string, string> = {};
  let at = 0;
  while (buf.readUInt32LE(at) === 0x04034b50) {
    const packed = buf.readUInt32LE(at + 18);
    const nameLength = buf.readUInt16LE(at + 26);
    const name = buf.subarray(at + 30, at + 30 + nameLength).toString("utf8");
    const data = buf.subarray(at + 30 + nameLength, at + 30 + nameLength + packed);
    out[name] = inflateRawSync(data).toString("utf8");
    at += 30 + nameLength + packed;
  }
  return out;
}

describe("createZip", () => {
  it("writes entries that read back, with a valid end of directory", () => {
    const buf = createZip([
      { name: "main.tex", data: "\\documentclass{article} Müller" },
      { name: "references.bib", data: "@book{a,}" },
    ]);
    expect(unzip(buf)).toEqual({
      "main.tex": "\\documentclass{article} Müller",
      "references.bib": "@book{a,}",
    });
    expect(buf.readUInt32LE(buf.length - 22)).toBe(0x06054b50);
    expect(buf.readUInt16LE(buf.length - 22 + 10)).toBe(2);
  });
});

describe("buildPandocArgs", () => {
  const common = { lang: "de-DE", style: "apa" };

  it("builds the Word export with citeproc, the CSL style and the language", () => {
    const plan = buildPandocArgs({ ...common, format: "docx" });
    expect(plan.output).toBe("main.docx");
    expect(plan.args).toEqual(
      expect.arrayContaining([
        "main.md",
        "--citeproc",
        "--bibliography",
        "references.json",
        "--csl",
        "style.csl",
        "lang=de-DE",
        "reference-section-title=Literaturverzeichnis",
        "-o",
        "main.docx",
      ]),
    );
    expect(plan.args).toContain("docx");
    expect(plan.args).not.toContain("--biblatex");
  });

  it("builds the LaTeX export with biblatex and the bib file instead of citeproc", () => {
    const plan = buildPandocArgs({ ...common, format: "latex" });
    expect(plan.output).toBe("main.tex");
    expect(plan.args).toEqual(
      expect.arrayContaining(["-s", "latex", "--biblatex", "--bibliography", "references.bib"]),
    );
    expect(plan.args).toContain("biblio-style=apa");
    expect(plan.args).not.toContain("--citeproc");
    expect(plan.needs).toEqual(["references.bib"]);
  });

  it("sets the page for a LaTeX engine: A4, 11 pt, margins of 2.5 cm", () => {
    const tex = buildPandocArgs({
      ...common,
      format: "pdf",
      pdfEngine: "/Library/TeX/texbin/xelatex",
    });
    expect(tex.output).toBe("main.pdf");
    expect(tex.args).toContain("--pdf-engine=/Library/TeX/texbin/xelatex");
    expect(tex.args).toEqual(expect.arrayContaining([...LATEX_LAYOUT, "--citeproc"]));
    expect(tex.args).toContain("geometry:margin=2.5cm");
    expect(tex.args).not.toContain("margin.x=2.5cm");
  });

  it("sets the page for Typst: A4, 11 pt, serif font, margins of 2.5 cm, page numbers", () => {
    const typst = buildPandocArgs({
      ...common,
      format: "pdf",
      pdfEngine: "/Users/a/Library/Application Support/citegeist/typst/0.15.1/typst",
    });
    expect(typst.args).toContain(
      "--pdf-engine=/Users/a/Library/Application Support/citegeist/typst/0.15.1/typst",
    );
    expect(typst.args).toEqual(expect.arrayContaining([...TYPST_LAYOUT]));
    for (const v of [
      "papersize=a4",
      "margin.x=2.5cm",
      "margin.y=2.5cm",
      "fontsize=11pt",
      "mainfont=New York",
      "page-numbering=1",
    ]) {
      expect(typst.args).toContain(v);
    }
    // APA asks for entry spacing 0, which Pandoc writes as par(spacing: 0em) and Typst overprints
    expect(typst.args).toContain("header-includes=#show <refs>: set par(spacing: 0.7em)");
    expect(typst.args).not.toContain("geometry:margin=2.5cm");
  });

  it("formats the PDF citations through citeproc and takes the language for hyphenation", () => {
    const typst = buildPandocArgs({
      ...common,
      format: "pdf",
      lang: "en-GB",
      pdfEngine: "/opt/homebrew/bin/typst",
    });
    expect(typst.args).toEqual(
      expect.arrayContaining([
        "-s",
        "pdf",
        "--citeproc",
        "--bibliography",
        "references.json",
        "--csl",
        "style.csl",
        "lang=en-GB",
        "reference-section-title=References",
        "link-citations=true",
      ]),
    );
    expect(typst.needs).toEqual(["references.json", "style.csl"]);
  });

  it("writes plain Markdown with the citations resolved", () => {
    const plan = buildPandocArgs({ ...common, format: "md" });
    expect(plan.args.join(" ")).toContain("markdown-fenced_divs-native_divs-raw_html");
    expect(plan.args).toContain("--citeproc");
  });

  it("adds the folder of the text to the resource path and titles the bibliography by language", () => {
    const plan = buildPandocArgs({ ...common, format: "docx", textDir: "/lib/projects/p/texts" });
    expect(plan.args).toContain(".:/lib/projects/p/texts");
    expect(referenceTitle("en-GB")).toBe("References");
    expect(referenceTitle("fr")).toBeUndefined();
  });

  it("maps CSL styles to biblatex styles", () => {
    expect(biblatexStyle("apa")).toBe("apa");
    expect(biblatexStyle("chicago-author-date")).toBe("chicago-authordate");
    expect(biblatexStyle("my-own")).toBe("authoryear");
  });
});

describe("locatePandoc", () => {
  const found = (versions: Record<string, string | null>) =>
    fakeRunner((spec) => {
      const v = versions[spec.command];
      if (v === undefined) return { exitCode: null, spawnError: "ENOENT" };
      if (v === null) return { exitCode: 1 };
      return { stdout: `pandoc ${v}\nFeatures: +server +lua\n` };
    });

  it("parses the version line", () => {
    expect(parsePandocVersion("pandoc 3.12.1\nFeatures: +server")).toBe("3.12.1");
    expect(parsePandocVersion("pandoc.exe 2.19\n")).toBe("2.19");
    expect(parsePandocVersion("something else")).toBeUndefined();
  });

  it("finds Pandoc on PATH first", async () => {
    const runner = found({ "/usr/bin/pandoc": "3.1.2" });
    const out = await locatePandoc({
      localBase: "/local",
      runner,
      pathEnv: "/usr/bin",
      home: "/home/x",
      exists: (p) => p === "/usr/bin/pandoc",
    });
    expect(out.location).toEqual({ path: "/usr/bin/pandoc", version: "3.1.2", source: "path" });
  });

  it("finds the Homebrew copy although the app has a minimal PATH", async () => {
    const runner = found({ "/opt/homebrew/bin/pandoc": "3.5" });
    const out = await locatePandoc({
      localBase: "/local",
      runner,
      pathEnv: "/usr/bin:/bin",
      home: "/home/x",
      exists: (p) => p === "/opt/homebrew/bin/pandoc",
    });
    expect(out.location?.path).toBe("/opt/homebrew/bin/pandoc");
  });

  it("falls back to the downloaded copy and skips one that is too old", async () => {
    const managed = managedPandocPath("/local");
    const runner = found({ "/usr/bin/pandoc": "2.9.2", [managed]: "3.12.1" });
    const out = await locatePandoc({
      localBase: "/local",
      runner,
      pathEnv: "/usr/bin",
      home: "/home/x",
      exists: (p) => p === "/usr/bin/pandoc" || p === managed,
    });
    expect(out.location).toEqual({ path: managed, version: "3.12.1", source: "managed" });
    expect(out.rejected).toEqual([
      expect.objectContaining({ path: "/usr/bin/pandoc", version: "2.9.2" }),
    ]);
  });

  it("reports nothing when no candidate exists or runs", async () => {
    const none = await locatePandoc({
      localBase: "/local",
      runner: found({}),
      pathEnv: "",
      home: "/home/x",
      exists: () => false,
    });
    expect(none.location).toBeUndefined();
    const broken = await locatePandoc({
      localBase: "/local",
      runner: found({ "/usr/bin/pandoc": null }),
      pathEnv: "/usr/bin",
      home: "/home/x",
      exists: (p) => p === "/usr/bin/pandoc",
    });
    expect(broken.location).toBeUndefined();
    expect(broken.rejected).toHaveLength(1);
  });

  it("finds the first LaTeX engine in the preferred order and leaves Typst to its own search", () => {
    const exists = (p: string) =>
      p === "/opt/homebrew/bin/typst" || p === "/Library/TeX/texbin/lualatex";
    expect(findPdfEngine({ pathEnv: "/usr/bin", home: "/home/x", exists })).toEqual({
      name: "lualatex",
      path: "/Library/TeX/texbin/lualatex",
    });
    expect(findPdfEngine({ pathEnv: "", home: "/h", exists: () => false })).toBeUndefined();
  });
});

describe("installPandoc", () => {
  const bytes = Buffer.from("pretend this is a zip archive");
  const spec = {
    ...PINNED_PANDOC,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
  const respond =
    (body: Buffer, status = 200) =>
    async () =>
      new Response(body, { status, headers: { "content-length": String(body.length) } });

  /** A runner whose "unzip" lays out the archive folder with a pandoc binary. */
  const unzipRunner = (version = "3.12.1") =>
    fakeRunner((run) => {
      if (run.command.endsWith("unzip")) {
        const target = run.args[run.args.indexOf("-d") + 1] as string;
        mkdirSync(join(target, spec.folder, "bin"), { recursive: true });
        writeFileSync(join(target, spec.folder, "bin", "pandoc"), "#!/bin/sh\n");
        return {};
      }
      return { stdout: `pandoc ${version}\n` };
    });

  it("downloads, checks the sha256, unpacks and verifies the binary", async () => {
    const base = tmpDir("cg-pandoc-");
    const runner = unzipRunner();
    const steps: number[] = [];
    const out = await installPandoc(
      { progress: (v) => steps.push(v) },
      { localBase: base, spec, fetch: respond(bytes), runner, platform: "darwin", arch: "arm64" },
    );
    expect(out).toEqual({ path: managedPandocPath(base, spec), version: "3.12.1" });
    expect(existsSync(out.path)).toBe(true);
    expect(statSync(out.path).mode & 0o111).not.toBe(0);
    expect(steps.at(-1)).toBe(1);
    expect(readdirSync(join(base, "pandoc"))).toEqual([spec.version]);
  });

  it("refuses a download whose sha256 differs and unpacks nothing", async () => {
    const base = tmpDir("cg-pandoc-");
    const runner = unzipRunner();
    const err = await installPandoc(
      { progress: () => undefined },
      {
        localBase: base,
        spec,
        fetch: respond(Buffer.from("tampered")),
        runner,
        platform: "darwin",
        arch: "arm64",
      },
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CitegeistError);
    expect((err as CitegeistError).detail.code).toBe("PANDOC_CHECKSUM");
    expect(runner.calls.filter((c) => c.command.endsWith("unzip"))).toHaveLength(0);
    expect(existsSync(managedPandocPath(base, spec))).toBe(false);
  });

  it("reports a failed download with a fix", async () => {
    const err = await installPandoc(
      { progress: () => undefined },
      {
        localBase: tmpDir("cg-pandoc-"),
        spec,
        fetch: respond(Buffer.alloc(0), 404),
        runner: unzipRunner(),
        platform: "darwin",
        arch: "arm64",
      },
    ).catch((e: unknown) => e);
    expect((err as CitegeistError).detail.code).toBe("PANDOC_DOWNLOAD_FAILED");
    expect((err as CitegeistError).detail.fix).toContain("brew install pandoc");
  });

  it("does not download for platforms the pin does not cover", async () => {
    const err = await installPandoc(
      { progress: () => undefined },
      { localBase: tmpDir("cg-pandoc-"), platform: "linux", arch: "x64" },
    ).catch((e: unknown) => e);
    expect((err as CitegeistError).detail.code).toBe("PANDOC_NOT_INSTALLABLE");
  });

  it("pins an official GitHub release with a sha256", () => {
    expect(PINNED_PANDOC.url).toMatch(
      /^https:\/\/github\.com\/jgm\/pandoc\/releases\/download\/[\d.]+\/pandoc-[\d.]+-arm64-macOS\.zip$/,
    );
    expect(PINNED_PANDOC.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("Typst", () => {
  const found = (versions: Record<string, string | null>) =>
    fakeRunner((spec) => {
      const v = versions[spec.command];
      if (v === undefined) return { exitCode: null, spawnError: "ENOENT" };
      if (v === null) return { exitCode: 1 };
      return { stdout: `typst ${v} (9dfd3a08)\n` };
    });

  it("parses the version line", () => {
    expect(parseTypstVersion("typst 0.15.1 (9dfd3a08)")).toBe("0.15.1");
    expect(parseTypstVersion("something else")).toBeUndefined();
  });

  it("prefers the downloaded copy over one on PATH", async () => {
    const managed = managedTypstPath("/local");
    const out = await locateTypst({
      localBase: "/local",
      runner: found({ [managed]: "0.15.1", "/opt/homebrew/bin/typst": "0.13.0" }),
      pathEnv: "/usr/bin",
      home: "/home/x",
      exists: (p) => p === managed || p === "/opt/homebrew/bin/typst",
    });
    expect(out.location).toEqual({ path: managed, version: "0.15.1", source: "managed" });
  });

  it("falls back to Homebrew's copy and rejects one that is too old or broken", async () => {
    const managed = managedTypstPath("/local");
    const exists = (p: string) => p === managed || p === "/opt/homebrew/bin/typst";
    const ok = await locateTypst({
      localBase: "/local",
      runner: found({ [managed]: null, "/opt/homebrew/bin/typst": "0.13.0" }),
      pathEnv: "/usr/bin",
      home: "/home/x",
      exists,
    });
    expect(ok.location).toMatchObject({ path: "/opt/homebrew/bin/typst", source: "path" });
    expect(ok.rejected).toHaveLength(1);
    const old = await locateTypst({
      localBase: "/local",
      runner: found({ "/opt/homebrew/bin/typst": "0.9.0" }),
      pathEnv: "/usr/bin",
      home: "/home/x",
      exists,
    });
    expect(old.location).toBeUndefined();
    expect(old.rejected.find((r) => r.version)).toMatchObject({ version: "0.9.0" });
  });

  it("finds nothing when no copy exists", async () => {
    const out = await locateTypst({
      localBase: "/local",
      runner: found({}),
      pathEnv: "",
      home: "/h",
      exists: () => false,
    });
    expect(out).toEqual({ rejected: [] });
  });

  it("chooses Typst over a LaTeX engine, the engine without Typst, and nothing without both", () => {
    const latex = { name: "xelatex", path: "/Library/TeX/texbin/xelatex" };
    expect(choosePdfEngine({ typst: { path: "/t/typst" }, latex })).toEqual({
      name: "typst",
      path: "/t/typst",
    });
    expect(choosePdfEngine({ latex })).toEqual(latex);
    expect(choosePdfEngine({ typst: { path: "/t/typst" } })).toEqual({
      name: "typst",
      path: "/t/typst",
    });
    expect(choosePdfEngine({})).toBeUndefined();
  });

  it("pins an official GitHub release with a sha256", () => {
    expect(PINNED_TYPST.url).toMatch(
      /^https:\/\/github\.com\/typst\/typst\/releases\/download\/v[\d.]+\/typst-aarch64-apple-darwin\.tar\.xz$/,
    );
    expect(PINNED_TYPST.url).toContain(`v${PINNED_TYPST.version}/`);
    expect(PINNED_TYPST.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  describe("installTypst", () => {
    const bytes = Buffer.from("pretend this is a tar.xz archive");
    const spec = { ...PINNED_TYPST, sha256: createHash("sha256").update(bytes).digest("hex") };
    const respond =
      (body: Buffer, status = 200) =>
      async () =>
        new Response(body, { status, headers: { "content-length": String(body.length) } });
    const deps = (base: string, extra: Record<string, unknown> = {}) => ({
      localBase: base,
      spec,
      platform: "darwin",
      arch: "arm64",
      ...extra,
    });

    /** A runner whose "tar" lays out the archive folder with a typst binary. */
    const tarRunner = (version = "0.15.1") =>
      fakeRunner((run) => {
        if (run.command.endsWith("tar")) {
          const target = run.args[run.args.indexOf("-C") + 1] as string;
          mkdirSync(join(target, spec.folder), { recursive: true });
          writeFileSync(join(target, spec.folder, "typst"), "#!/bin/sh\n");
          writeFileSync(join(target, spec.folder, "LICENSE"), "Apache");
          return {};
        }
        if (run.command.endsWith("xattr")) return {};
        return { stdout: `typst ${version} (9dfd3a08)\n` };
      });

    it("downloads, checks the sha256, unpacks, clears the quarantine flag and verifies the binary", async () => {
      const base = tmpDir("cg-typst-");
      const runner = tarRunner();
      const steps: number[] = [];
      const out = await installTypst(
        { progress: (v) => steps.push(v) },
        { ...deps(base), fetch: respond(bytes), runner },
      );
      expect(out).toEqual({ path: managedTypstPath(base, spec), version: "0.15.1" });
      expect(statSync(out.path).mode & 0o111).not.toBe(0);
      expect(readdirSync(join(base, "typst"))).toEqual([spec.version]);
      expect(readdirSync(join(base, "typst", spec.version)).sort()).toEqual(["LICENSE", "typst"]);
      expect(steps.at(-1)).toBe(1);
      const xattr = runner.calls.find((c) => c.command.endsWith("xattr"));
      expect(xattr?.args).toEqual([
        "-dr",
        "com.apple.quarantine",
        join(base, "typst", spec.version),
      ]);
      // order: unpack, then clear the flag, then run the binary once
      expect(runner.calls.map((c) => c.command.split("/").pop())).toEqual([
        "tar",
        "xattr",
        "typst",
      ]);
    });

    it("refuses a download whose sha256 differs and unpacks nothing", async () => {
      const base = tmpDir("cg-typst-");
      const runner = tarRunner();
      const err = await installTypst(
        { progress: () => undefined },
        { ...deps(base), fetch: respond(Buffer.from("tampered")), runner },
      ).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(CitegeistError);
      expect((err as CitegeistError).detail.code).toBe("TYPST_CHECKSUM");
      expect(runner.calls).toHaveLength(0);
      expect(existsSync(managedTypstPath(base, spec))).toBe(false);
      expect(readdirSync(join(base, "typst"))).toEqual([]);
    });

    it("reports a failed download with a fix", async () => {
      const err = await installTypst(
        { progress: () => undefined },
        { ...deps(tmpDir("cg-typst-")), fetch: respond(Buffer.alloc(0), 404), runner: tarRunner() },
      ).catch((e: unknown) => e);
      expect((err as CitegeistError).detail.code).toBe("TYPST_DOWNLOAD_FAILED");
      expect((err as CitegeistError).detail.fix).toContain("brew install typst");
    });

    it("removes a download whose binary does not run", async () => {
      const base = tmpDir("cg-typst-");
      const runner = fakeRunner((run) =>
        run.command.endsWith("tar")
          ? (() => {
              const target = run.args[run.args.indexOf("-C") + 1] as string;
              mkdirSync(join(target, spec.folder), { recursive: true });
              writeFileSync(join(target, spec.folder, "typst"), "x");
              return {};
            })()
          : run.command.endsWith("xattr")
            ? {}
            : { exitCode: 126, spawnError: "bad CPU type" },
      );
      const err = await installTypst(
        { progress: () => undefined },
        { ...deps(base), fetch: respond(bytes), runner },
      ).catch((e: unknown) => e);
      expect((err as CitegeistError).detail.code).toBe("TYPST_UNUSABLE");
      expect(existsSync(join(base, "typst", spec.version))).toBe(false);
    });

    it("does not download for platforms the pin does not cover", async () => {
      const err = await installTypst(
        { progress: () => undefined },
        { localBase: tmpDir("cg-typst-"), platform: "linux", arch: "x64" },
      ).catch((e: unknown) => e);
      expect((err as CitegeistError).detail.code).toBe("TYPST_NOT_INSTALLABLE");
    });
  });
});

// Service ---------------------------------------------------------------------------------------

async function setup(
  runner = fakeRunner(() => ({})),
  extra: Partial<Parameters<typeof bindTextsOperations>[2]> = {},
) {
  const lib = await Library.init(tmpDir("cg-texts-"), {
    name: "Test",
    localBase: tmpDir("cg-local-"),
    watch: false,
  });
  open.push(lib);
  lib.createProject("human", { slug: "phd", title: "PhD", brief: "Brief" });
  lib.writeItem(itemData("luhmann1984soziale"));
  lib.writeItem(
    itemData("gillespie2018custodians", {
      author: [{ family: "Gillespie", given: "Tarleton" }],
      issued: 2018,
    }),
  );
  const registry = new Registry();
  const queue = new JobQueue({ dbPath: join(tmpDir("cg-jobs-"), "state.sqlite") });
  const service = bindTextsOperations(registry, lib, {
    localBase: tmpDir("cg-base-"),
    queue,
    runner,
    locate: async () => ({
      location: { path: "/usr/bin/pandoc", version: "3.12.1", source: "path" },
      rejected: [],
    }),
    // no Typst and no LaTeX engine unless a test says otherwise
    locateTypst: async () => ({ rejected: [] }),
    pathEnv: "",
    home: "/nowhere",
    exists: () => false,
    ...extra,
  });
  const call = <T>(name: string, input: unknown, actor = "human") =>
    registry.call(name, { actor: actor as "human" }, input) as Promise<T>;
  return { lib, service, call, queue, runner };
}

interface Got {
  hash: string;
  body: string;
  cited: string[];
  unknown: string[];
  resolved: { style: string; lang: string };
  title: string;
}

const BODY =
  "# Kapitel\n\nLuhmann [@luhmann1984soziale, S. 12] und @gillespie2018custodians. Fehlt [@nobody2020none].\n";

describe("texts operations", () => {
  it("creates a text with frontmatter and a slug from the title", async () => {
    const { lib, call } = await setup();
    const made = await call<{ text: string; path: string }>("texts.create", {
      project: "phd",
      title: "Kapitel 2",
      body: BODY,
    });
    expect(made.text).toBe("kapitel-2");
    expect(made.path).toBe("projects/phd/texts/kapitel-2.md");
    const raw = readFileSync(join(lib.root, made.path), "utf8");
    expect(raw).toMatch(/^---\ntitle: Kapitel 2\ncreated:/);
    expect(raw).toContain("[@luhmann1984soziale, S. 12]");
    const again = await call<{ text: string }>("texts.create", {
      project: "phd",
      title: "Kapitel 2",
    });
    expect(again.text).toBe("kapitel-2-2");
  });

  it("refuses an explicit slug that exists and an unknown style", async () => {
    const { call } = await setup();
    await call("texts.create", { project: "phd", title: "A", slug: "a" });
    await expect(
      call("texts.create", { project: "phd", title: "B", slug: "a" }),
    ).rejects.toMatchObject({
      detail: { code: "TEXT_EXISTS" },
    });
    await expect(
      call("texts.create", { project: "phd", title: "C", style: "nope" }),
    ).rejects.toMatchObject({ detail: { code: "TEXT_UNKNOWN_STYLE" } });
  });

  it("reads a text with its cited and unknown keys and the resolved style and language", async () => {
    const { call } = await setup();
    await call("texts.create", { project: "phd", title: "Kapitel 2", body: BODY });
    const got = await call<Got>("texts.get", { project: "phd", text: "kapitel-2" });
    expect(got.title).toBe("Kapitel 2");
    expect(got.cited).toEqual(["luhmann1984soziale", "gillespie2018custodians", "nobody2020none"]);
    expect(got.unknown).toEqual(["nobody2020none"]);
    expect(got.resolved).toEqual({ style: "apa", lang: "de-DE" });
    expect(got.body).toBe(BODY.trim());
  });

  it("lets the text override style and language, and the project language come before its locale", async () => {
    const { lib, call } = await setup();
    lib.updateProject({ slug: "phd", patch: { ai_language: "en" } });
    await call("texts.create", { project: "phd", title: "En", slug: "en" });
    expect((await call<Got>("texts.get", { project: "phd", text: "en" })).resolved).toEqual({
      style: "apa",
      lang: "en",
    });
    await call("texts.create", {
      project: "phd",
      title: "De",
      slug: "de",
      style: "chicago-author-date",
      lang: "de-AT",
    });
    expect((await call<Got>("texts.get", { project: "phd", text: "de" })).resolved).toEqual({
      style: "chicago-author-date",
      lang: "de-AT",
    });
  });

  it("lists texts with word and citation counts", async () => {
    const { call } = await setup();
    await call("texts.create", { project: "phd", title: "Kapitel 2", body: BODY });
    await call("texts.create", { project: "phd", title: "Leer" });
    const { texts } = await call<{
      texts: Array<{ text: string; words: number; citations: number; title: string }>;
    }>("texts.list", { project: "phd" });
    expect(texts.map((t) => t.text)).toEqual(["kapitel-2", "leer"]);
    expect(texts[0]).toMatchObject({ citations: 3, title: "Kapitel 2" });
    expect(texts[0]?.words).toBeGreaterThan(5);
    expect(texts[1]).toMatchObject({ words: 0, citations: 0 });
  });

  it("updates the body and keeps the frontmatter, and detects a change in between", async () => {
    const { lib, call } = await setup();
    const made = await call<{ hash: string }>("texts.create", {
      project: "phd",
      title: "K",
      slug: "k",
    });
    const out = await call<{ hash: string; cited: string[] }>("texts.update", {
      project: "phd",
      text: "k",
      body: "Neu [@luhmann1984soziale].",
      baseHash: made.hash,
    });
    expect(out.cited).toEqual(["luhmann1984soziale"]);
    const raw = readFileSync(join(lib.root, "projects/phd/texts/k.md"), "utf8");
    expect(raw).toContain("title: K");
    expect(raw).toContain("Neu [@luhmann1984soziale].");
    await expect(
      call("texts.update", { project: "phd", text: "k", body: "x", baseHash: made.hash }),
    ).rejects.toMatchObject({ detail: { code: "TEXT_CHANGED" } });
    await call("texts.update", { project: "phd", text: "k", style: "apa", title: "Kapitel K" });
    const after = readFileSync(join(lib.root, "projects/phd/texts/k.md"), "utf8");
    expect(after).toContain("title: Kapitel K");
    expect(after).toContain("style: apa");
    await call("texts.update", { project: "phd", text: "k", style: "", lang: "" });
    const cleared = readFileSync(join(lib.root, "projects/phd/texts/k.md"), "utf8");
    expect(cleared).not.toContain("style:");
    expect(cleared).toContain("title: Kapitel K");
  });

  it("names the texts that exist when one is missing", async () => {
    const { call } = await setup();
    await call("texts.create", { project: "phd", title: "A", slug: "a" });
    await expect(call("texts.get", { project: "phd", text: "b" })).rejects.toMatchObject({
      detail: { code: "TEXT_NOT_FOUND", fix: expect.stringContaining("a") },
    });
  });
});

describe("texts.export with a mocked Pandoc", () => {
  /** A Pandoc that writes the output file named after `-o` and records what it was given. */
  function pandoc() {
    const seen: { files: Record<string, string>; args: string[] }[] = [];
    const runner = fakeRunner((spec) => {
      const files: Record<string, string> = {};
      for (const name of readdirSync(spec.cwd))
        files[name] = readFileSync(join(spec.cwd, name), "utf8");
      seen.push({ files, args: spec.args });
      const out = spec.args[spec.args.indexOf("-o") + 1] as string;
      writeFileSync(join(spec.cwd, out), `OUTPUT of ${out}`);
      return { stderr: "[WARNING] Citeproc: citation nobody2020none not found\n" };
    });
    return { runner, seen };
  }

  it("exports Word with the bibliography of the cited sources only", async () => {
    const { runner, seen } = pandoc();
    const { lib, call } = await setup(runner);
    await call("texts.create", { project: "phd", title: "Kapitel 2", body: BODY });
    const out = await call<{
      path: string;
      unknown: string[];
      warnings: string[];
      pandoc: string;
      bytes: number;
    }>("texts.export", { project: "phd", text: "kapitel-2", format: "docx" });

    expect(out.path).toBe("projects/phd/exports/kapitel-2.docx");
    expect(readFileSync(join(lib.root, out.path), "utf8")).toBe("OUTPUT of main.docx");
    expect(out.unknown).toEqual(["nobody2020none"]);
    expect(out.warnings).toEqual(["[WARNING] Citeproc: citation nobody2020none not found"]);
    expect(out.pandoc).toBe("3.12.1");

    const run = seen[0];
    expect(run?.args).toEqual(expect.arrayContaining(["--citeproc", "--csl", "style.csl"]));
    const csl = JSON.parse(run?.files["references.json"] ?? "[]") as Array<{ id: string }>;
    expect(csl.map((c) => c.id).sort()).toEqual(["gillespie2018custodians", "luhmann1984soziale"]);
    expect(run?.files["style.csl"]).toContain("<style");
    expect(run?.files["main.md"]).toContain("[@luhmann1984soziale, S. 12]");
    expect(runner.calls[0]?.command).toBe("/usr/bin/pandoc");
  });

  it("exports LaTeX as a ZIP with main.tex and references.bib", async () => {
    const { runner, seen } = pandoc();
    const { lib, call } = await setup(runner);
    await call("texts.create", { project: "phd", title: "Kapitel 2", body: BODY });
    const out = await call<{ path: string }>("texts.export", {
      project: "phd",
      text: "kapitel-2",
      format: "latex",
    });
    expect(out.path).toBe("projects/phd/exports/kapitel-2.zip");
    const entries = unzip(readFileSync(join(lib.root, out.path)));
    expect(Object.keys(entries)).toEqual(["main.tex", "references.bib"]);
    expect(entries["main.tex"]).toBe("OUTPUT of main.tex");
    expect(entries["references.bib"]).toContain("@book{luhmann1984soziale,");
    expect(entries["references.bib"]).toContain("@book{gillespie2018custodians,");
    expect(entries["references.bib"]).not.toContain("nobody2020none");
    expect(seen[0]?.args).toContain("--biblatex");
  });

  it("takes style and language from the request, then the text, then the project", async () => {
    const { runner, seen } = pandoc();
    const { call } = await setup(runner);
    await call("texts.create", {
      project: "phd",
      title: "K",
      slug: "k",
      style: "chicago-author-date",
      lang: "en-GB",
    });
    await call("texts.export", { project: "phd", text: "k", format: "md" });
    expect(seen[0]?.args).toContain("lang=en-GB");
    expect(seen[0]?.files["style.csl"]).toContain("Chicago");
    const out = await call<{ style: string }>("texts.export", {
      project: "phd",
      text: "k",
      format: "md",
      style: "apa",
    });
    expect(out.style).toBe("apa");
  });

  it("explains how to get Typst when no PDF engine is installed", async () => {
    const { call } = await setup(pandoc().runner);
    await call("texts.create", { project: "phd", title: "K", slug: "k" });
    await expect(
      call("texts.export", { project: "phd", text: "k", format: "pdf" }),
    ).rejects.toMatchObject({
      detail: {
        code: "PDF_ENGINE_MISSING",
        message: expect.stringContaining("Typst"),
        fix: expect.stringContaining("typst.setup"),
        recovery: "ask-human",
      },
    });
  });

  it("runs Pandoc with Typst for a PDF and sets the page", async () => {
    const { runner, seen } = pandoc();
    const typst = "/support/citegeist/typst/0.15.1/typst";
    const { call } = await setup(runner, {
      locateTypst: async () => ({
        location: { path: typst, version: "0.15.1", source: "managed" },
        rejected: [],
      }),
    });
    await call("texts.create", { project: "phd", title: "K", slug: "k" });
    const out = await call<{ engine: string; path: string }>("texts.export", {
      project: "phd",
      text: "k",
      format: "pdf",
    });
    expect(out.engine).toBe("typst");
    expect(out.path).toBe("projects/phd/exports/k.pdf");
    expect(seen[0]?.args).toContain(`--pdf-engine=${typst}`);
    expect(seen[0]?.args).toContain("--citeproc");
    expect(seen[0]?.args).toContain("margin.x=2.5cm");
    expect(seen[0]?.args).toContain("papersize=a4");
  });

  it("prefers Typst although a LaTeX engine is installed, and uses the engine without Typst", async () => {
    const latex = (p: string) => p === "/Library/TeX/texbin/xelatex";
    const withTypst = pandoc();
    const a = await setup(withTypst.runner, {
      exists: latex,
      locateTypst: async () => ({
        location: { path: "/opt/homebrew/bin/typst", version: "0.15.1", source: "path" },
        rejected: [],
      }),
    });
    await a.call("texts.create", { project: "phd", title: "K", slug: "k" });
    const first = await a.call<{ engine: string }>("texts.export", {
      project: "phd",
      text: "k",
      format: "pdf",
    });
    expect(first.engine).toBe("typst");

    const without = pandoc();
    const b = await setup(without.runner, { exists: latex });
    await b.call("texts.create", { project: "phd", title: "K", slug: "k" });
    const second = await b.call<{ engine: string }>("texts.export", {
      project: "phd",
      text: "k",
      format: "pdf",
    });
    expect(second.engine).toBe("xelatex");
    expect(without.seen[0]?.args).toContain("--pdf-engine=/Library/TeX/texbin/xelatex");
    expect(without.seen[0]?.args).toContain("geometry:margin=2.5cm");
  });

  it("tells a person how to get Pandoc when it is missing", async () => {
    const { call } = await setup(pandoc().runner, {
      locate: async () => ({ rejected: [] }),
    });
    await call("texts.create", { project: "phd", title: "K", slug: "k" });
    const err = await call("texts.export", { project: "phd", text: "k", format: "docx" }).catch(
      (e: unknown) => e as CitegeistError,
    );
    expect((err as CitegeistError).detail).toMatchObject({
      code: "PANDOC_MISSING",
      recovery: "ask-human",
    });
    expect((err as CitegeistError).detail.fix).toContain("brew install pandoc");
    expect((err as CitegeistError).detail.fix).toContain("pandoc.setup");
  });

  it("surfaces Pandoc's own error text when the run fails", async () => {
    const runner = fakeRunner(() => ({
      exitCode: 64,
      stderr: "Error producing PDF.\n! LaTeX Error: File `x.sty' not found.\n",
    }));
    const { call } = await setup(runner);
    await call("texts.create", { project: "phd", title: "K", slug: "k" });
    await expect(
      call("texts.export", { project: "phd", text: "k", format: "docx" }),
    ).rejects.toMatchObject({
      detail: { code: "PANDOC_FAILED", message: expect.stringContaining("x.sty") },
    });
  });

  it("lets only a person write outside the library", async () => {
    const { runner } = pandoc();
    const { call } = await setup(runner);
    await call("texts.create", { project: "phd", title: "K", slug: "k" });
    const target = join(tmpDir("cg-out-"), "kapitel.docx");
    const out = await call<{ path: string; absolutePath: string }>("texts.export", {
      project: "phd",
      text: "k",
      format: "docx",
      output: target,
    });
    expect(out.path).toBe(target);
    expect(existsSync(target)).toBe(true);
    await expect(
      call(
        "texts.export",
        { project: "phd", text: "k", format: "docx", output: target },
        "agent:grok",
      ),
    ).rejects.toMatchObject({ detail: { code: "TEXT_OUTPUT_FORBIDDEN" } });
  });

  it("removes its working directory afterwards", async () => {
    const { runner, seen } = pandoc();
    const { call } = await setup(runner);
    await call("texts.create", { project: "phd", title: "K", slug: "k" });
    await call("texts.export", { project: "phd", text: "k", format: "docx" });
    expect(seen).toHaveLength(1);
    expect(existsSync(runner.calls[0]?.cwd ?? "")).toBe(false);
  });
});

describe("pandoc operations", () => {
  it("reports where Pandoc is and which PDF engine exists", async () => {
    const { call } = await setup(undefined, {
      locateTypst: async () => ({
        location: { path: "/opt/homebrew/bin/typst", version: "0.15.1", source: "path" },
        rejected: [],
      }),
    });
    const status = await call<Record<string, unknown>>("pandoc.status", {});
    expect(status).toMatchObject({
      found: true,
      path: "/usr/bin/pandoc",
      version: "3.12.1",
      source: "path",
      pinned: PINNED_PANDOC.version,
      pdfEngine: "typst",
    });
  });

  it("queues a setup job for a person, once", async () => {
    const { call, queue } = await setup();
    const first = await call<{ job: string }>("pandoc.setup", {});
    const second = await call<{ job: string }>("pandoc.setup", {});
    expect(second.job).toBe(first.job);
    expect(queue.get(first.job)?.kind).toBe("pandoc-setup");
  });

  it("downloads right away in a process that does not run the queue", async () => {
    const bytes = Buffer.from("zip bytes");
    const spec = { ...PINNED_PANDOC, sha256: createHash("sha256").update(bytes).digest("hex") };
    const runner = fakeRunner((run) => {
      if (run.command.endsWith("unzip")) {
        const target = run.args[run.args.indexOf("-d") + 1] as string;
        mkdirSync(join(target, spec.folder, "bin"), { recursive: true });
        writeFileSync(join(target, spec.folder, "bin", "pandoc"), "#!/bin/sh\n");
        return {};
      }
      return { stdout: "pandoc 3.12.1\n" };
    });
    const { call, queue } = await setup(runner, {
      inline: true,
      spec,
      fetch: async () => new Response(bytes, { status: 200 }),
    });
    // the pin only covers macOS on Apple silicon; elsewhere the call fails with a fix
    const attempt = await call<{ job: string }>("pandoc.setup", {}).catch((e: unknown) => e);
    if (process.platform === "darwin" && process.arch === "arm64") {
      const job = queue.get((attempt as { job: string }).job);
      expect(job).toMatchObject({ kind: "pandoc-setup", status: "succeeded" });
    } else {
      expect((attempt as CitegeistError).detail.code).toBe("PANDOC_NOT_INSTALLABLE");
    }
  });

  it("is a human operation", async () => {
    const { call } = await setup();
    await expect(call("pandoc.setup", {}, "agent:grok")).rejects.toMatchObject({
      detail: { code: "FORBIDDEN_ADMIN" },
    });
  });
});

describe("typst operations", () => {
  it("reports where Typst is and what the download would be", async () => {
    const missing = await setup();
    expect(await missing.call("typst.status", {})).toEqual({
      found: false,
      pinned: PINNED_TYPST.version,
      installable: process.platform === "darwin" && process.arch === "arm64",
      sizeMb: PINNED_TYPST.sizeMb,
    });
    const there = await setup(undefined, {
      locateTypst: async () => ({
        location: { path: "/t/typst", version: "0.15.1", source: "managed" },
        rejected: [],
      }),
    });
    expect(await there.call("typst.status", {})).toMatchObject({
      found: true,
      path: "/t/typst",
      version: "0.15.1",
      source: "managed",
    });
  });

  it("queues a setup job for a person, once", async () => {
    const { call, queue } = await setup();
    const first = await call<{ job: string }>("typst.setup", {});
    const second = await call<{ job: string }>("typst.setup", {});
    expect(second.job).toBe(first.job);
    expect(queue.get(first.job)?.kind).toBe("typst-setup");
  });

  it("runs the setup job through the queue and refuses a wrong checksum", async () => {
    const { call, queue } = await setup(undefined, {
      fetch: async () => new Response(Buffer.from("tampered"), { status: 200 }),
    });
    const { job } = await call<{ job: string }>("typst.setup", {});
    queue.start();
    await vi.waitFor(() => expect(queue.get(job)?.status).toBe("failed"), { timeout: 5000 });
    // the installable check comes first, so off Apple silicon the code differs
    const code = queue.get(job)?.error?.code;
    expect(code).toBe(
      process.platform === "darwin" && process.arch === "arm64"
        ? "TYPST_CHECKSUM"
        : "TYPST_NOT_INSTALLABLE",
    );
    await queue.close();
  });

  it("is a human operation", async () => {
    const { call } = await setup();
    await expect(call("typst.setup", {}, "agent:grok")).rejects.toMatchObject({
      detail: { code: "FORBIDDEN_ADMIN" },
    });
  });
});
