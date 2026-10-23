import { existsSync, readFileSync } from "node:fs";
import type { AiRouter } from "@citegeist/ai";
import {
  createTextAnchor,
  type Location,
  locate,
  NORM_ID,
  normalizeText,
  resolveAnchor,
  type TextAnchorRecord,
} from "@citegeist/anchoring";
import { exportCards } from "@citegeist/cite";
import {
  type Actor,
  type CardBody,
  CardFrontmatter,
  type ItemFrontmatter,
  Locator,
  type ModelStamp,
  type Pages,
  type ProjectFrontmatter,
  TextAnchor,
} from "@citegeist/schema";
import type { z } from "zod";
import { parseCardBody, serializeCardBody } from "../card-body.js";
import { MarkdownFile } from "../frontmatter.js";
import { writeFileAtomic } from "../fsutil.js";
import { normalizeNewlines, quoteSha256 } from "../hash.js";
import { newCardId } from "../ids.js";
import type { Library } from "../library.js";
import { DerivedStore } from "./derived.js";
import { cardErrors } from "./errors.js";
import { type CardJobQueue, DetachedJobs } from "./jobs.js";

export interface CardDeps {
  /** Routes `card.paraphrase` and `card.verify` to the configured backend. */
  ai: Pick<AiRouter, "run">;
  /** Core job queue. Without one, AI work runs detached in this process. */
  jobs?: CardJobQueue;
  /** Run `card.verify` after each paraphrase and store the verdict in `paraphrase.checked`. */
  verify?: boolean;
}

type AnchorInput = z.input<typeof CardFrontmatter>["anchor"];

export interface CreateCardInput {
  citekey: string;
  anchor: AnchorInput;
  quote: string;
  kind?: CardFrontmatter["kind"] | undefined;
  ai?: boolean | undefined;
  language?: string | undefined;
  projects?: string[] | undefined;
  tags?: string[] | undefined;
}

export interface CardFile {
  frontmatter: CardFrontmatter;
  body: CardBody;
}

export interface ExportCardsInput {
  ids: string[];
  mode?: "direct" | "indirect" | undefined;
  format?: "html" | "text" | "pandoc" | "latex" | "typst" | undefined;
  project?: string | undefined;
}

const PATCH_KEYS = new Set([
  "ownWords",
  "comment",
  "paraphrase",
  "core",
  "extra",
  "kind",
  "tags",
  "locator",
]);

/** Card operations of the core: create, update, regenerate, export and page label confirmation. */
export class CardService {
  readonly jobs: CardJobQueue;
  /** Set when no queue was injected: lets callers and tests wait for detached AI work. */
  readonly detached: DetachedJobs | undefined;
  private readonly derived: DerivedStore;

  constructor(
    private readonly lib: Library,
    private readonly deps: CardDeps,
  ) {
    this.derived = new DerivedStore(lib.paths);
    if (deps.jobs) {
      this.jobs = deps.jobs;
      this.detached = undefined;
    } else {
      this.detached = new DetachedJobs();
      this.jobs = this.detached;
    }
  }

  // Reading --------------------------------------------------------------------------------------

  private cardPath(id: string): string {
    const row = this.lib.index.get<{ path: string }>("SELECT path FROM cards WHERE id = ?", id);
    if (!row) throw cardErrors.notFound(id);
    return row.path;
  }

  getCard(id: string): CardFile {
    const p = this.lib.readParsed(this.cardPath(id));
    if (p.kind !== "card") throw cardErrors.notFound(id);
    return { frontmatter: p.fm, body: p.body };
  }

  // Create ---------------------------------------------------------------------------------------

  /** Writes the card file at once. Paraphrase and core statement follow from a background job. */
  create(actor: Actor, input: CreateCardInput): { card: CardFile; job?: string } {
    const item = this.lib.getItem(input.citekey).frontmatter;
    const quote = normalizeNewlines(input.quote).trim();
    if (quote === "") {
      throw cardErrors.invalidAnchor(
        "the quote is empty after trimming",
        "Pass the selected passage as 'quote'.",
      );
    }
    const resolved = this.resolveAnchor(item, quote, input.anchor);
    const projects = input.projects ?? [];
    const created = this.lib.stamp(actor);
    const fm = CardFrontmatter.parse({
      id: newCardId(Date.parse(created.at)),
      item: item.citekey,
      ...(resolved.source ? { source: resolved.source } : {}),
      kind: input.kind ?? "quote",
      ...(resolved.locator ? { locator: resolved.locator } : {}),
      anchor: resolved.anchor,
      quote_sha256: quoteSha256(quote),
      tags: input.tags ?? [],
      projects,
      created,
    });
    this.lib.writeCard(fm, { quote, extra: [] });
    const card = this.getCard(fm.id);
    if (input.ai === false) return { card };
    const language = this.languageFor(item, projects, input.language);
    return { card, job: this.scheduleAi(actor, fm.id, language, true) };
  }

  /** Validates the anchor and derives block, page index, printed page label and locator. */
  private resolveAnchor(
    item: ItemFrontmatter,
    quote: string,
    anchor: AnchorInput,
  ): { source?: string; anchor: CardFrontmatter["anchor"]; locator?: Locator } {
    if (!anchor.pdf && !anchor.text) {
      throw cardErrors.invalidAnchor(
        "the anchor has neither a pdf nor a text part",
        "Pass anchor.pdf (page, quads, file) from a PDF selection or anchor.text (exact, prefix, suffix) from a text selection.",
      );
    }
    const citekey = item.citekey;
    let source: string | undefined;
    if (anchor.pdf) {
      source = anchor.pdf.file;
      if (!item.sources.some((s) => s.hash === source)) {
        throw cardErrors.invalidAnchor(
          `anchor.pdf.file '${source}' is not a source of '${citekey}'`,
          "Use items.get to list the sources of the item and pass the hash of the PDF.",
          { citekey, source },
        );
      }
    } else {
      source = this.pickSource(item);
    }
    const doc = source ? this.derived.blocks(citekey, source) : undefined;
    const pages = source ? this.derived.pages(citekey, source) : undefined;
    if (anchor.pdf && pages && anchor.pdf.page >= pages.pages.length) {
      throw cardErrors.invalidAnchor(
        `anchor.pdf.page ${anchor.pdf.page} is outside the ${pages.pages.length} pages of source ${source}`,
        "Pass the zero-based page index of the selection.",
        { citekey, source, page: anchor.pdf.page },
      );
    }

    let text: CardFrontmatter["anchor"]["text"] = anchor.text
      ? TextAnchor.parse(anchor.text)
      : undefined;
    let loc: Location | undefined;
    if (doc && source) {
      const rec: TextAnchorRecord = {
        exact: normalizeText(anchor.text?.exact ?? quote),
        prefix: anchor.text?.prefix ?? "",
        suffix: anchor.text?.suffix ?? "",
        start: anchor.text?.start,
        end: anchor.text?.end,
        block: anchor.text?.block,
      };
      const r = resolveAnchor(doc.stream, rec, { pageHint: anchor.pdf?.page });
      if (r.status === "anchored") {
        loc = locate(doc.stream, r.start, r.end);
        const base = createTextAnchor(doc.stream, r.start, r.end);
        if (base) {
          text = TextAnchor.parse({
            ...(base.block ? { block: base.block } : {}),
            exact: base.exact,
            prefix: base.prefix,
            suffix: base.suffix,
            start: base.start,
            end: base.end,
            norm: NORM_ID,
          });
        }
      } else if (!anchor.pdf) {
        throw cardErrors.anchorNotFound(citekey, source);
      }
    }

    const first = anchor.pdf?.page ?? loc?.first?.page;
    const last = loc?.last?.page ?? first;
    const locator = buildLocator(first, last, pages, loc);
    return {
      ...(source ? { source } : {}),
      anchor: { ...(anchor.pdf ? { pdf: anchor.pdf } : {}), ...(text ? { text } : {}) },
      ...(locator ? { locator } : {}),
    };
  }

  private pickSource(item: ItemFrontmatter): string | undefined {
    const converted = item.sources.filter((s) => this.derived.hasBlocks(item.citekey, s.hash));
    return (converted.find((s) => s.role === "main") ?? converted[0] ?? item.sources[0])?.hash;
  }

  // AI texts -------------------------------------------------------------------------------------

  /** D9: item (reader dropdown), then project, then library default; an explicit value wins. */
  private languageFor(
    item: ItemFrontmatter,
    cardProjects: readonly string[],
    explicit?: string,
  ): string {
    if (explicit) return explicit;
    if (item.ai_language) return item.ai_language;
    for (const slug of cardProjects.length > 0 ? cardProjects : item.projects) {
      const lang = this.projectOrUndefined(slug)?.ai_language;
      if (lang) return lang;
    }
    return this.lib.manifest.defaults.ai_language;
  }

  private projectOrUndefined(slug: string): ProjectFrontmatter | undefined {
    try {
      return this.lib.getProject(slug).frontmatter;
    } catch {
      return undefined;
    }
  }

  private scheduleAi(actor: Actor, id: string, language: string, fillOnly: boolean): string {
    return this.jobs.enqueue({
      kind: "ai-task",
      label: `card.paraphrase ${id}`,
      by: actor,
      input: { id, language },
      run: () => this.generate(id, language, fillOnly),
    });
  }

  /** Runs card.paraphrase (and card.verify when enabled) and writes the result into the card. */
  private async generate(id: string, language: string, fillOnly: boolean): Promise<void> {
    const { body } = this.getCard(id);
    const passage = body.quote;
    const r = await this.deps.ai.run("card.paraphrase", { passage }, { language });
    let checked: boolean | undefined;
    if (this.deps.verify) {
      try {
        const v = await this.deps.ai.run(
          "card.verify",
          { passage, paraphrase: r.output.paraphrase, core: r.output.core },
          { language },
        );
        checked = v.output.faithful;
      } catch {
        checked = undefined;
      }
    }
    this.applyAi(id, fillOnly, {
      paraphrase: r.output.paraphrase,
      core: r.output.core,
      stamp: r.stamp,
      checked,
    });
  }

  private applyAi(
    id: string,
    fillOnly: boolean,
    ai: {
      paraphrase: string;
      core: string;
      stamp: { by: string; at: string; language: string };
      checked: boolean | undefined;
    },
  ): void {
    let rel: string;
    try {
      rel = this.cardPath(id);
    } catch {
      return; // the card was removed while the job ran
    }
    // Read after the await so edits made while the model ran are kept.
    const file = MarkdownFile.parse(readFileSync(this.lib.paths.abs(rel), "utf8"));
    const body = parseCardBody(file.body);
    if (fillOnly && (body.paraphrase !== undefined || body.core !== undefined)) return;
    body.paraphrase = ai.paraphrase;
    body.core = ai.core;
    const stamp: ModelStamp = { by: ai.stamp.by, at: ai.stamp.at, language: ai.stamp.language };
    file.patch({
      paraphrase: ai.checked === undefined ? stamp : { ...stamp, checked: ai.checked },
      core: stamp,
      modified: this.lib.stamp("system"),
    });
    file.setBody(serializeCardBody(body));
    this.lib.writeFile(rel, file.toString());
  }

  /** Rewrites paraphrase and core statement, optionally in another language. */
  regenerate(actor: Actor, input: { id: string; language?: string | undefined }): { job: string } {
    const { frontmatter } = this.getCard(input.id);
    const item = this.lib.getItem(frontmatter.item).frontmatter;
    const language = this.languageFor(item, frontmatter.projects, input.language);
    return { job: this.scheduleAi(actor, input.id, language, false) };
  }

  // Update ---------------------------------------------------------------------------------------

  /** Edits own words, comment, kind, tags or locator. The quote can never change. */
  update(actor: Actor, input: { id: string; patch: Record<string, unknown> }): { card: CardFile } {
    const { id, patch } = input;
    if ("quote" in patch) throw cardErrors.quoteImmutable(id);
    for (const key of Object.keys(patch)) {
      if (!PATCH_KEYS.has(key)) {
        throw cardErrors.invalidPatch(
          id,
          `field '${key}' cannot be patched on a card`,
          `Patch one of: ${[...PATCH_KEYS].join(", ")}.`,
        );
      }
    }
    const rel = this.cardPath(id);
    const file = MarkdownFile.parse(readFileSync(this.lib.paths.abs(rel), "utf8"));
    const body = parseCardBody(file.body);
    const before = body.quote;
    const fm: Record<string, unknown> = {};
    const stamp = this.lib.stamp(actor);

    const setText = (key: "ownWords" | "comment" | "paraphrase" | "core", v: unknown): void => {
      if (v === undefined) return;
      if (typeof v !== "string") {
        throw cardErrors.invalidPatch(id, `'${key}' must be a string`, `Pass '${key}' as text.`);
      }
      if (v === "") delete body[key];
      else body[key] = v;
    };
    setText("ownWords", patch.ownWords);
    setText("comment", patch.comment);
    if (patch.paraphrase !== undefined) {
      setText("paraphrase", patch.paraphrase);
      fm.paraphrase = patch.paraphrase === "" ? undefined : { by: actor, at: stamp.at };
    }
    if (patch.core !== undefined) {
      setText("core", patch.core);
      fm.core = patch.core === "" ? undefined : { by: actor, at: stamp.at };
    }
    if (patch.extra !== undefined) {
      body.extra = (patch.extra as CardBody["extra"]) ?? [];
    }
    if (patch.kind !== undefined) fm.kind = patch.kind;
    if (patch.tags !== undefined) fm.tags = patch.tags;
    if (patch.locator !== undefined) {
      const l = Locator.safeParse(patch.locator);
      if (!l.success) {
        throw cardErrors.invalidPatch(
          id,
          `invalid locator: ${l.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
          "Pass a locator like {label: 'page', start: '31', end: '32'}.",
        );
      }
      // A locator typed by a person counts as confirmed.
      fm.locator = { ...l.data, confirmed: true };
    }
    if (body.quote !== before) throw cardErrors.quoteImmutable(id);
    const check = CardFrontmatter.safeParse({ ...file.data, ...fm });
    if (!check.success) {
      throw cardErrors.invalidPatch(
        id,
        `the patch makes the card invalid: ${check.error.issues
          .slice(0, 5)
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; ")}`,
        "Fix the patch values so that they match the card schema.",
      );
    }
    file.patch({ ...fm, modified: stamp });
    file.setBody(serializeCardBody(body));
    this.lib.writeFile(rel, file.toString());
    return { card: this.getCard(id) };
  }

  // Export ---------------------------------------------------------------------------------------

  export(input: ExportCardsInput): { html?: string; text: string } {
    const project = input.project ? this.lib.getProject(input.project).frontmatter : undefined;
    const entries = input.ids.map((id) => {
      const { frontmatter, body } = this.getCard(id);
      const item = this.lib.getItem(frontmatter.item).frontmatter;
      const via = frontmatter.via ? this.lib.getItem(frontmatter.via).frontmatter : undefined;
      return { card: frontmatter, body, item, ...(via ? { via } : {}) };
    });
    const defaults = this.lib.manifest.defaults;
    return exportCards(entries, {
      mode: input.mode ?? "direct",
      format: input.format ?? "html",
      style: project?.style ?? defaults.style,
      locale: project?.locale ?? defaults.locale,
      policy: project?.export,
    });
  }

  // Page labels ----------------------------------------------------------------------------------

  /**
   * Stores the printed page label mapping of a PDF (pages.json, `confirmed: true`) and rewrites
   * the locator of every card of that PDF. `offset` maps PDF page index i to label i + 1 + offset,
   * `labels` (keys are zero-based PDF page indexes) overrides single pages afterwards.
   */
  confirmPages(
    actor: Actor,
    input: {
      citekey: string;
      source: string;
      offset?: number | undefined;
      labels?: Record<string, string> | undefined;
    },
  ): { cardsUpdated: number } {
    const { citekey, source } = input;
    const item = this.lib.getItem(citekey).frontmatter;
    if (!item.sources.some((s) => s.hash === source))
      throw cardErrors.sourceNotFound(citekey, source);
    const file = this.lib.paths.pages(citekey, source);
    if (!existsSync(file)) throw cardErrors.pagesMissing(citekey, source);
    const raw = JSON.parse(readFileSync(file, "utf8")) as Pages;
    const count = raw.pages.length;
    for (const key of Object.keys(input.labels ?? {})) {
      const n = Number(key);
      if (!Number.isInteger(n) || n < 0 || n >= count) {
        throw cardErrors.invalidPages(
          `label key '${key}' is not a page index of this PDF (0 to ${count - 1})`,
          "Use zero-based PDF page indexes as keys of 'labels'.",
          { citekey, source, key },
        );
      }
    }
    const pages = raw.pages.map((p) => {
      let label = p.label;
      let labelSource = p.labelSource;
      if (input.offset !== undefined) {
        const n = p.index + 1 + input.offset;
        label = n >= 1 ? String(n) : null;
        labelSource = "user";
      }
      const explicit = input.labels?.[String(p.index)];
      if (explicit !== undefined) {
        label = explicit;
        labelSource = "user";
      }
      return { ...p, label, labelSource };
    });
    const next = { ...raw, pages, confirmed: true } as Pages;
    writeFileAtomic(file, `${JSON.stringify(next, null, 2)}\n`);
    this.derived.forgetPages(citekey, source);
    return { cardsUpdated: this.relocateCards(actor, citekey, source, next) };
  }

  private relocateCards(actor: Actor, citekey: string, source: string, pages: Pages): number {
    const doc = this.derived.blocks(citekey, source);
    const stamp = this.lib.stamp(actor);
    let updated = 0;
    let cursor: string | undefined;
    for (;;) {
      const page = this.lib.listCards({ citekey, limit: 200, cursor });
      for (const { frontmatter: fm } of page.cards) {
        if ((fm.source ?? fm.anchor.pdf?.file) !== source) continue;
        if (fm.locator && fm.locator.label !== "page") continue;
        let first = fm.anchor.pdf?.page;
        let last = first;
        let loc: Location | undefined;
        const t = fm.anchor.text;
        if (doc && t) {
          const r = resolveAnchor(
            doc.stream,
            {
              exact: t.exact,
              prefix: t.prefix,
              suffix: t.suffix,
              start: t.start,
              end: t.end,
              block: t.block,
            },
            { pageHint: first },
          );
          if (r.status === "anchored") {
            loc = locate(doc.stream, r.start, r.end);
            first = first ?? loc.first?.page;
            last = loc.last?.page ?? first;
          }
        }
        const locator = buildLocator(first, last, pages, loc);
        if (!locator) continue;
        if (JSON.stringify(locator) === JSON.stringify(fm.locator)) continue;
        const rel = this.cardPath(fm.id);
        const f = MarkdownFile.parse(readFileSync(this.lib.paths.abs(rel), "utf8"));
        f.patch({ locator: { ...locator, confirmed: true }, modified: stamp });
        this.lib.writeFile(rel, f.toString());
        updated++;
      }
      if (!page.next) return updated;
      cursor = page.next;
    }
  }
}

/** Locator from the printed labels of the first and last page of a card. */
function buildLocator(
  first: number | undefined,
  last: number | undefined,
  pages: Pages | undefined,
  loc: Location | undefined,
): Locator | undefined {
  if (first === undefined) return undefined;
  const labelOf = (p: number): string | null =>
    pages?.pages.find((x) => x.index === p)?.label ??
    loc?.pages.find((x) => x.page === p)?.label ??
    null;
  const a = labelOf(first);
  if (!a) return undefined;
  const b = last !== undefined && last > first ? labelOf(last) : null;
  return Locator.parse({
    label: "page",
    start: a,
    ...(b && b !== a ? { end: b } : {}),
    confirmed: pages?.confirmed ?? false,
  });
}
