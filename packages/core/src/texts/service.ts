import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { nodeRunner, type ProcessRunner } from "@citegeist/ai";
import { BUNDLED_STYLES, exportCslJson, hasStyle, styleXml, toBibtex } from "@citegeist/cite";
import type { TextExportFormat } from "@citegeist/ops";
import {
  type Actor,
  CitegeistError,
  citedKeys,
  type ItemFrontmatter,
  TextSlug,
} from "@citegeist/schema";
import { MarkdownFile } from "../frontmatter.js";
import { writeFileAtomic } from "../fsutil.js";
import { sha256Hex } from "../hash.js";
import { slugify } from "../ids.js";
import type { Library } from "../library.js";
import { extendedPath } from "../settings/executables.js";
import { buildPandocArgs, exportExtension, FILES } from "./args.js";
import {
  findPdfEngine,
  type LocateOptions,
  locatePandoc,
  type PandocLocation,
  type PandocLookup,
  PINNED_PANDOC,
  pandocInstallable,
} from "./pandoc.js";
import { createZip } from "./zip.js";

export interface TextsDeps {
  /** Machine-local base directory, where `pandoc.setup` keeps the downloaded copy. */
  localBase: string;
  runner?: ProcessRunner;
  now?: () => Date;
  /** Replaces the search for Pandoc, for tests. */
  locate?: () => Promise<PandocLookup>;
  /** Replaces the search for a PDF engine, for tests. */
  pdfEngine?: () => { name: string; path: string } | undefined;
  pathEnv?: string | undefined;
  home?: string | undefined;
  exists?: LocateOptions["exists"];
}

function fail(
  code: string,
  message: string,
  fix: string,
  context: Record<string, unknown> = {},
  recovery: "fix-and-retry" | "do-first" | "ask-human" = "fix-and-retry",
) {
  return new CitegeistError({ code, message, fix, recovery, context });
}

const WORD = /[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu;
const WARNING_LIMIT = 10;

export interface TextFile {
  text: string;
  path: string;
  raw: string;
  title: string;
  style?: string | undefined;
  lang?: string | undefined;
  body: string;
}

/** Texts of a project: Markdown files with Pandoc citations (docs/decisions/0002-writing-in-markdown-with-pandoc.md), exported through Pandoc. */
export class TextsService {
  private readonly runner: ProcessRunner;
  private readonly now: () => Date;

  constructor(
    private readonly lib: Library,
    private readonly deps: TextsDeps,
  ) {
    this.runner = deps.runner ?? nodeRunner;
    this.now = deps.now ?? (() => new Date());
  }

  // Paths and reading -------------------------------------------------------------------------

  private dir = (project: string): string => `projects/${project}/texts`;
  private rel = (project: string, text: string): string => `${this.dir(project)}/${text}.md`;

  private slugs(project: string): string[] {
    try {
      return readdirSync(this.lib.paths.abs(this.dir(project)), { withFileTypes: true })
        .filter((e) => e.isFile() && e.name.endsWith(".md"))
        .map((e) => e.name.slice(0, -3))
        .filter((s) => TextSlug.safeParse(s).success)
        .sort();
    } catch {
      return [];
    }
  }

  private read(project: string, text: string): TextFile {
    this.lib.getProject(project);
    const path = this.rel(project, text);
    if (!existsSync(this.lib.paths.abs(path))) {
      const all = this.slugs(project);
      throw fail(
        "TEXT_NOT_FOUND",
        `project '${project}' has no text '${text}'`,
        all.length > 0
          ? `Use one of: ${all.join(", ")}. Or create it with texts.create.`
          : "Create a text with texts.create first.",
        { project, text },
      );
    }
    const raw = readFileSync(this.lib.paths.abs(path), "utf8");
    const file = MarkdownFile.parse(raw);
    const data = file.data ?? {};
    const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
    return {
      text,
      path,
      raw,
      title: str(data.title) ?? text,
      style: str(data.style),
      lang: str(data.lang),
      body: file.body,
    };
  }

  private isKnown(key: string): boolean {
    return this.lib.index.get("SELECT 1 AS n FROM items WHERE citekey = ?", key) !== undefined;
  }

  private resolved(project: string, file: Pick<TextFile, "style" | "lang">) {
    const p = this.lib.getProject(project).frontmatter;
    return {
      style: file.style ?? p.style ?? this.lib.manifest.defaults.style,
      // The language of the text, else the language of the project (docs/decisions/0016-ai-text-language.md), else its citation locale.
      lang: file.lang ?? p.ai_language ?? p.locale ?? this.lib.manifest.defaults.locale,
    };
  }

  private citations(body: string) {
    const cited = citedKeys(body);
    return { cited, unknown: cited.filter((k) => !this.isKnown(k)) };
  }

  // Operations --------------------------------------------------------------------------------

  list(project: string) {
    this.lib.getProject(project);
    return {
      texts: this.slugs(project).map((slug) => {
        const f = this.read(project, slug);
        return {
          text: slug,
          title: f.title,
          path: f.path,
          ...(f.style ? { style: f.style } : {}),
          ...(f.lang ? { lang: f.lang } : {}),
          words: f.body.match(WORD)?.length ?? 0,
          citations: citedKeys(f.body).length,
          updated: statSync(this.lib.paths.abs(f.path)).mtime.toISOString(),
        };
      }),
    };
  }

  get(project: string, text: string) {
    const f = this.read(project, text);
    return {
      text,
      path: f.path,
      title: f.title,
      ...(f.style ? { style: f.style } : {}),
      ...(f.lang ? { lang: f.lang } : {}),
      resolved: this.resolved(project, f),
      body: f.body,
      hash: sha256Hex(f.raw),
      ...this.citations(f.body),
    };
  }

  private checkStyle(style: string | undefined): void {
    if (style === undefined || hasStyle(style)) return;
    throw fail(
      "TEXT_UNKNOWN_STYLE",
      `the citation style '${style}' is not available`,
      `Use one of: ${BUNDLED_STYLES.join(", ")}.`,
      { style },
    );
  }

  create(
    actor: Actor,
    input: {
      project: string;
      title: string;
      slug?: string | undefined;
      style?: string | undefined;
      lang?: string | undefined;
      body: string;
    },
  ) {
    this.lib.getProject(input.project);
    this.checkStyle(input.style);
    let slug = input.slug ?? slugify(input.title);
    if (input.slug && existsSync(this.lib.paths.abs(this.rel(input.project, slug)))) {
      throw fail(
        "TEXT_EXISTS",
        `project '${input.project}' already has a text '${slug}'`,
        "Choose another slug, or change the text with texts.update.",
        { project: input.project, text: slug },
      );
    }
    if (!input.slug) {
      const base = slug;
      for (let i = 2; existsSync(this.lib.paths.abs(this.rel(input.project, slug))); i++) {
        slug = `${base}-${i}`;
      }
    }
    const data: Record<string, unknown> = {
      title: input.title,
      ...(input.style ? { style: input.style } : {}),
      ...(input.lang ? { lang: input.lang } : {}),
      created: this.lib.stamp(actor),
    };
    const out = MarkdownFile.create(data, input.body).toString();
    const path = this.rel(input.project, slug);
    this.lib.writeFile(path, out);
    return { text: slug, path, hash: sha256Hex(out) };
  }

  update(input: {
    project: string;
    text: string;
    body?: string | undefined;
    title?: string | undefined;
    style?: string | undefined;
    lang?: string | undefined;
    baseHash?: string | undefined;
  }) {
    const current = this.read(input.project, input.text);
    if (input.baseHash && input.baseHash !== sha256Hex(current.raw)) {
      throw fail(
        "TEXT_CHANGED",
        `${current.path} changed since you read it`,
        "Read the text again with texts.get, apply your edit to the new body and retry with its hash.",
        { path: current.path },
      );
    }
    // An empty style or language takes the key out, so the project's setting applies again.
    this.checkStyle(input.style || undefined);
    const file = MarkdownFile.parse(current.raw);
    const patch: Record<string, unknown> = {};
    if (input.title !== undefined) patch.title = input.title;
    if (input.style !== undefined) patch.style = input.style || undefined;
    if (input.lang !== undefined) patch.lang = input.lang || undefined;
    if (Object.keys(patch).length > 0) file.patch(patch);
    if (input.body !== undefined) file.setBody(input.body);
    const out = file.toString();
    if (out !== current.raw) this.lib.writeFile(current.path, out);
    return {
      path: current.path,
      hash: sha256Hex(out),
      ...this.citations(file.body),
    };
  }

  // Pandoc ------------------------------------------------------------------------------------

  private async locate(): Promise<PandocLookup> {
    if (this.deps.locate) return this.deps.locate();
    return locatePandoc({
      localBase: this.deps.localBase,
      runner: this.runner,
      pathEnv: this.deps.pathEnv,
      ...(this.deps.home ? { home: this.deps.home } : {}),
      ...(this.deps.exists ? { exists: this.deps.exists } : {}),
    });
  }

  private engine() {
    if (this.deps.pdfEngine) return this.deps.pdfEngine();
    return findPdfEngine({
      pathEnv: this.deps.pathEnv,
      ...(this.deps.home ? { home: this.deps.home } : {}),
      ...(this.deps.exists ? { exists: this.deps.exists } : {}),
    });
  }

  async status() {
    const { location } = await this.locate();
    const engine = this.engine();
    return {
      found: location !== undefined,
      ...(location
        ? { path: location.path, version: location.version, source: location.source }
        : {}),
      pinned: PINNED_PANDOC.version,
      installable: pandocInstallable(),
      ...(engine ? { pdfEngine: engine.name } : {}),
    };
  }

  private async requirePandoc(): Promise<PandocLocation> {
    const { location, rejected } = await this.locate();
    if (location) return location;
    const old = rejected.find((r) => r.version);
    throw fail(
      "PANDOC_MISSING",
      old
        ? `Pandoc ${old.version} at ${old.path} is too old for citations (2.11 or newer is needed).`
        : "Pandoc was not found on this Mac.",
      pandocInstallable()
        ? "Install it with `brew install pandoc`, or run pandoc.setup to download the pinned release (in the app: Texte, Pandoc installieren)."
        : "Install it with `brew install pandoc` or from https://pandoc.org/installing.html.",
      { rejected },
      "ask-human",
    );
  }

  // Export ------------------------------------------------------------------------------------

  private target(
    actor: Actor,
    input: { project: string; text: string; output?: string | undefined },
    format: TextExportFormat,
  ): string {
    if (input.output === undefined) {
      return this.lib.paths.abs(
        `projects/${input.project}/exports/${input.text}.${exportExtension(format)}`,
      );
    }
    if (actor !== "human") {
      throw fail(
        "TEXT_OUTPUT_FORBIDDEN",
        "Only a person may choose where an export goes.",
        "Leave output out. The file lands in projects/<project>/exports/ of the library.",
        { output: input.output },
        "fix-and-retry",
      );
    }
    const expanded = input.output.startsWith("~/")
      ? join(homedir(), input.output.slice(2))
      : input.output;
    return isAbsolute(expanded) ? expanded : resolve(expanded);
  }

  async export(
    actor: Actor,
    input: {
      project: string;
      text: string;
      format: TextExportFormat;
      style?: string | undefined;
      lang?: string | undefined;
      output?: string | undefined;
    },
  ) {
    const file = this.read(input.project, input.text);
    const settings = this.resolved(input.project, file);
    const style = input.style ?? settings.style;
    const lang = input.lang ?? settings.lang;
    this.checkStyle(style);
    const xml = styleXml(style);
    if (!xml)
      throw fail("TEXT_UNKNOWN_STYLE", `no CSL file for '${style}'`, "Use a bundled style.");

    const { cited, unknown } = this.citations(file.body);
    const items: ItemFrontmatter[] = cited
      .filter((k) => !unknown.includes(k))
      .map((k) => this.lib.getItem(k).frontmatter);

    const pandoc = await this.requirePandoc();
    let engine: { name: string; path: string } | undefined;
    if (input.format === "pdf") {
      engine = this.engine();
      if (!engine) {
        throw fail(
          "PDF_ENGINE_MISSING",
          "A PDF needs a LaTeX engine or Typst, and none was found.",
          "Install BasicTeX (`brew install --cask basictex`) or Typst (`brew install typst`), or export docx or latex instead.",
          {},
          "ask-human",
        );
      }
    }
    const destination = this.target(actor, input, input.format);

    const plan = buildPandocArgs({
      format: input.format,
      lang,
      style,
      pdfEngine: engine?.path,
      textDir: dirname(this.lib.paths.abs(file.path)),
    });
    const work = mkdtempSync(join(tmpdir(), "cg-texts-"));
    try {
      writeFileSync(join(work, FILES.input), file.raw);
      writeFileSync(join(work, FILES.csl), xml);
      writeFileSync(join(work, FILES.cslJson), exportCslJson(items));
      writeFileSync(join(work, FILES.bib), toBibtex(items));
      const ran = await this.runner({
        command: pandoc.path,
        args: plan.args,
        cwd: work,
        env: { PATH: extendedPath(), HOME: process.env.HOME, LANG: "en_US.UTF-8" },
        timeoutMs: input.format === "pdf" ? 300_000 : 120_000,
      });
      if (ran.timedOut || ran.exitCode !== 0 || !existsSync(join(work, plan.output))) {
        const tail = (ran.stderr || ran.spawnError || "no output").trim().slice(-600);
        throw fail(
          ran.timedOut ? "PANDOC_TIMEOUT" : "PANDOC_FAILED",
          ran.timedOut
            ? `Pandoc took too long to export ${file.path}.`
            : `Pandoc could not export ${file.path}: ${tail}`,
          input.format === "pdf"
            ? "Fix the problem named above (often a missing LaTeX package), or export docx or latex instead."
            : "Fix the problem named above in the text and export again.",
          { exitCode: ran.exitCode },
        );
      }
      const produced = readFileSync(join(work, plan.output));
      const bytes =
        input.format === "latex"
          ? createZip(
              [
                { name: "main.tex", data: produced },
                { name: "references.bib", data: readFileSync(join(work, FILES.bib)) },
              ],
              this.now(),
            )
          : produced;
      mkdirSync(dirname(destination), { recursive: true });
      writeFileAtomic(destination, bytes);
      const inside = relative(this.lib.root, destination);
      return {
        path:
          inside.startsWith("..") || isAbsolute(inside)
            ? destination
            : inside.split("\\").join("/"),
        absolutePath: destination,
        format: input.format,
        bytes: bytes.length,
        style,
        lang,
        cited,
        unknown,
        warnings: ran.stderr
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l.startsWith("[WARNING]"))
          .slice(0, WARNING_LIMIT),
        pandoc: pandoc.version,
        ...(engine ? { engine: engine.name } : {}),
      };
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }
}
