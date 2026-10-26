import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { basename } from "node:path";
import type { InsightHit, NumberedNode as NumberedNodeOut, OutlineOp } from "@citegeist/ops";
import {
  type Actor,
  CitegeistError,
  type Outline,
  PlanFrontmatter,
  type PlanTemplate,
} from "@citegeist/schema";
import { MarkdownFile } from "../frontmatter.js";
import { sha256Hex } from "../hash.js";
import { slugify, ulid } from "../ids.js";
import type { Library } from "../library.js";
import { stems, words } from "../text.js";
import {
  applyOps,
  descendants,
  type NumberedNode,
  newNodeId,
  numbered,
  parseOutline,
  resolveNode,
  serializeOutline,
} from "./outline.js";
import {
  appendParagraph,
  insightParagraph,
  type Paragraph,
  splitParagraphs,
} from "./paragraphs.js";
import { TEMPLATES, type TemplateNode, templateLanguage } from "./templates.js";

/**
 * Scores texts against a query for the semantic stage of find_insights. Returns one similarity
 * per text in 0..1, or undefined when it cannot rank. The runtime passes the embedder of the semantic index;
 * without it the service ranks by shared word stems.
 */
export type SemanticRank = (query: string, texts: string[]) => Promise<number[] | undefined>;

export interface PlanningOptions {
  now?: () => Date;
  rank?: SemanticRank;
}

/** A paragraph with the place it was found in. */
export interface PlacedParagraph extends Paragraph {
  path: string;
  plan?: string;
  /** Node whose document holds the paragraph. */
  node?: string;
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

const localDate = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export class PlanningService {
  private readonly now: () => Date;
  private readonly rank: SemanticRank | undefined;

  constructor(
    private readonly lib: Library,
    opts: PlanningOptions = {},
  ) {
    this.now = opts.now ?? (() => new Date());
    this.rank = opts.rank;
  }

  // Paths --------------------------------------------------------------------------------------

  private projectDir = (project: string): string => `projects/${project}`;
  private plansDir = (project: string): string => `${this.projectDir(project)}/plans`;
  private planDir = (project: string, plan: string): string => `${this.plansDir(project)}/${plan}`;
  private readText(rel: string): string | undefined {
    try {
      return readFileSync(this.lib.paths.abs(rel), "utf8");
    } catch {
      return undefined;
    }
  }

  private planSlugs(project: string): string[] {
    try {
      return readdirSync(this.lib.paths.abs(this.plansDir(project)), { withFileTypes: true })
        .filter(
          (e) =>
            e.isDirectory() &&
            existsSync(this.lib.paths.abs(`${this.plansDir(project)}/${e.name}/outline.yaml`)),
        )
        .map((e) => e.name)
        .sort();
    } catch {
      return [];
    }
  }

  /** The plan a call means: the given one, or the only one of the project. */
  private resolvePlan(project: string, plan: string | undefined): string {
    this.lib.getProject(project);
    const all = this.planSlugs(project);
    if (plan) {
      if (!all.includes(plan)) {
        throw fail(
          "PLAN_NOT_FOUND",
          `project '${project}' has no plan '${plan}'`,
          all.length > 0
            ? `Use one of: ${all.join(", ")}.`
            : "Create a plan with plans.create first.",
          { project, plan },
        );
      }
      return plan;
    }
    if (all.length === 1) return all[0] as string;
    if (all.length === 0) {
      throw fail(
        "PLAN_NOT_FOUND",
        `project '${project}' has no plan yet`,
        "Create one with plans.create.",
        { project },
        "do-first",
      );
    }
    throw fail(
      "PLAN_AMBIGUOUS",
      `project '${project}' has several plans: ${all.join(", ")}`,
      "Pass the plan slug.",
      { project, plans: all },
    );
  }

  private loadOutline(project: string, plan: string): Outline {
    const text = this.readText(`${this.planDir(project, plan)}/outline.yaml`);
    return parseOutline(text ?? "");
  }

  private saveOutline(project: string, plan: string, outline: Outline): void {
    this.lib.writeFile(`${this.planDir(project, plan)}/outline.yaml`, serializeOutline(outline));
  }

  /** Node id to the library-relative path of its document, read from the document frontmatter. */
  private nodeDocs(project: string, plan: string): Map<string, string> {
    const dir = `${this.planDir(project, plan)}/nodes`;
    const out = new Map<string, string>();
    let names: string[];
    try {
      names = readdirSync(this.lib.paths.abs(dir))
        .filter((n) => n.endsWith(".md"))
        .sort();
    } catch {
      return out;
    }
    for (const name of names) {
      const raw = this.readText(`${dir}/${name}`);
      const node = raw ? MarkdownFile.parse(raw).data?.node : undefined;
      if (typeof node === "string" && !out.has(node)) out.set(node, `${dir}/${name}`);
    }
    return out;
  }

  private createNodeDoc(project: string, plan: string, id: string, title: string): string {
    const dir = `${this.planDir(project, plan)}/nodes`;
    const base = slugify(title);
    let rel = `${dir}/${base}.md`;
    for (let i = 2; existsSync(this.lib.paths.abs(rel)); i++) rel = `${dir}/${base}-${i}.md`;
    const file = MarkdownFile.create({ node: id, aliases: [id] }, `# ${title}\n`);
    this.lib.writeFile(rel, file.toString());
    return rel;
  }

  private numberedOut(project: string, plan: string, outline: Outline): NumberedNodeOut[] {
    const docs = this.nodeDocs(project, plan);
    return numbered(outline).map((n) => {
      const doc = docs.get(n.id);
      return {
        id: n.id,
        title: n.title,
        parent: n.parent,
        order: n.order,
        ...(n.purpose ? { purpose: n.purpose } : {}),
        status: n.status,
        questions: n.questions,
        number: n.number,
        depth: n.depth,
        ...(doc ? { doc } : {}),
      };
    });
  }

  // Plans --------------------------------------------------------------------------------------

  createPlan(
    actor: Actor,
    input: { project: string; slug: string; title: string; template?: PlanTemplate | undefined },
  ) {
    const project = this.lib.getProject(input.project).frontmatter;
    // The template follows the AI language: the project's, else the library's default.
    const language = templateLanguage(
      project.ai_language ?? this.lib.manifest.defaults.ai_language,
    );
    const dir = this.planDir(input.project, input.slug);
    if (existsSync(this.lib.paths.abs(dir))) {
      throw fail(
        "PLAN_EXISTS",
        `project '${input.project}' already has a plan '${input.slug}'`,
        "Choose another slug.",
        { project: input.project, plan: input.slug },
      );
    }
    const fm = PlanFrontmatter.parse({
      title: input.title,
      ...(input.template ? { template: input.template } : {}),
      created: this.lib.stamp(actor),
    });
    const planFile = `${dir}/plan.md`;
    this.lib.writeFile(planFile, MarkdownFile.create(fm as Record<string, unknown>, "").toString());

    const nodes: Outline["nodes"] = [];
    const docs: Array<{ id: string; title: string }> = [];
    const add = (list: TemplateNode[], parent: string | null): void => {
      list.forEach((t, i) => {
        const id = newNodeId();
        nodes.push({
          id,
          title: t.title,
          parent,
          order: i + 1,
          purpose: t.purpose,
          status: "idea",
          questions: [],
        });
        if (parent === null) docs.push({ id, title: t.title });
        add(t.children ?? [], id);
      });
    };
    if (input.template) add(TEMPLATES[language][input.template].nodes, null);
    const outlineFile = `${dir}/outline.yaml`;
    this.lib.writeFile(outlineFile, serializeOutline({ nodes }));
    for (const d of docs) this.createNodeDoc(input.project, input.slug, d.id, d.title);
    return {
      project: input.project,
      plan: input.slug,
      title: input.title,
      path: planFile,
      outline: outlineFile,
      nodes: nodes.length,
    };
  }

  listPlans(project: string) {
    this.lib.getProject(project);
    return {
      plans: this.planSlugs(project).map((slug) => {
        const path = `${this.planDir(project, slug)}/plan.md`;
        const raw = this.readText(path);
        const data = raw ? MarkdownFile.parse(raw).data : null;
        const fm = PlanFrontmatter.safeParse(data ?? {});
        return {
          plan: slug,
          title: fm.success ? fm.data.title : slug,
          ...(fm.success && fm.data.template ? { template: fm.data.template } : {}),
          path,
          nodes: this.loadOutline(project, slug).nodes.length,
        };
      }),
    };
  }

  // Outline ------------------------------------------------------------------------------------

  getOutline(project: string, planRef?: string) {
    const plan = this.resolvePlan(project, planRef);
    const title = this.listPlans(project).plans.find((p) => p.plan === plan)?.title ?? plan;
    return {
      project,
      plan,
      title,
      nodes: this.numberedOut(project, plan, this.loadOutline(project, plan)),
    };
  }

  applyOutline(input: {
    project: string;
    plan?: string | undefined;
    ops: OutlineOp[];
    force: boolean;
  }) {
    const plan = this.resolvePlan(input.project, input.plan);
    const before = this.loadOutline(input.project, plan);
    const result = applyOps(before, input.ops);

    if (result.removed.length > 0) {
      const used = this.inUse(input.project, plan, result.removed);
      if (used.length > 0 && !input.force) {
        throw fail(
          "PLAN_NODE_IN_USE",
          `removing these nodes would orphan text: ${used.join("; ")}`,
          "Move the text first, or repeat the call with force: true to remove the nodes anyway.",
          { nodes: result.removed },
          "ask-human",
        );
      }
    }
    this.saveOutline(input.project, plan, result.outline);

    const docs = this.nodeDocs(input.project, plan);
    for (const id of result.removed) {
      const rel = docs.get(id);
      if (rel && this.docParagraphs(rel).length === 0)
        rmSync(this.lib.paths.abs(rel), { force: true });
    }
    for (const id of result.added) {
      const node = result.outline.nodes.find((n) => n.id === id);
      if (node && node.parent === null) this.createNodeDoc(input.project, plan, id, node.title);
    }
    return {
      project: input.project,
      plan,
      added: result.added,
      nodes: this.numberedOut(input.project, plan, result.outline),
    };
  }

  private docParagraphs(rel: string): Paragraph[] {
    const raw = this.readText(rel);
    return raw ? splitParagraphs(MarkdownFile.parse(raw).body) : [];
  }

  /** Human readable reasons why removing `ids` would lose something. */
  private inUse(project: string, plan: string, ids: string[]): string[] {
    const gone = new Set(ids);
    const docs = this.nodeDocs(project, plan);
    const docPaths = new Set<string>();
    const out: string[] = [];
    for (const id of ids) {
      const rel = docs.get(id);
      if (rel && this.docParagraphs(rel).length > 0) {
        docPaths.add(rel);
        out.push(`${id} has a document with text (${rel})`);
      }
    }
    const aliases = this.aliasMap(project);
    for (const p of this.projectParagraphs(project)) {
      if (docPaths.has(p.path)) continue;
      const hit = p.links.map((l) => aliases.get(l) ?? l).filter((l) => gone.has(l));
      if (hit.length > 0) out.push(`${p.path} links to ${[...new Set(hit)].join(", ")}`);
    }
    return out;
  }

  // Paragraphs ---------------------------------------------------------------------------------

  /** Document file name without extension to node id, so that [[kommunikationsbegriff]] resolves. */
  private aliasMap(project: string): Map<string, string> {
    const out = new Map<string, string>();
    for (const plan of this.planSlugs(project)) {
      for (const [id, rel] of this.nodeDocs(project, plan)) {
        out.set(basename(rel, ".md"), id);
      }
    }
    return out;
  }

  /** Every paragraph of the planning files of a project. */
  projectParagraphs(project: string): PlacedParagraph[] {
    const out: PlacedParagraph[] = [];
    const take = (rel: string, extra: { plan?: string; node?: string }) => {
      for (const p of this.docParagraphs(rel)) out.push({ ...p, path: rel, ...extra });
    };
    for (const plan of this.planSlugs(project)) {
      take(`${this.planDir(project, plan)}/plan.md`, { plan });
      for (const [node, rel] of this.nodeDocs(project, plan)) take(rel, { plan, node });
    }
    take(`${this.projectDir(project)}/insights.md`, {});
    return out;
  }

  // Documents ----------------------------------------------------------------------------------

  /** Where the document of `doc` is or would be, relative to the library root. */
  private docPath(project: string, plan: string, doc: string): { rel: string; exists: boolean } {
    if (doc === "plan") {
      const rel = `${this.planDir(project, plan)}/plan.md`;
      return { rel, exists: this.readText(rel) !== undefined };
    }
    const node = resolveNode(this.loadOutline(project, plan), doc);
    const existing = this.nodeDocs(project, plan).get(node.id);
    if (existing) return { rel: existing, exists: true };
    return { rel: `${this.planDir(project, plan)}/nodes/${slugify(node.title)}.md`, exists: false };
  }

  /** The text of the planning document or of a node document, with the hash for `baseHash`. */
  getDoc(input: { project: string; plan?: string | undefined; doc: string }) {
    const plan = this.resolvePlan(input.project, input.plan);
    const { rel, exists } = this.docPath(input.project, plan, input.doc);
    const raw = this.readText(rel) ?? "";
    return {
      path: rel,
      body: exists ? MarkdownFile.parse(raw).body : "",
      hash: sha256Hex(raw),
      exists,
    };
  }

  updateDoc(input: {
    project: string;
    plan?: string | undefined;
    doc: string;
    body: string;
    baseHash?: string | undefined;
  }) {
    const plan = this.resolvePlan(input.project, input.plan);
    const found = this.docPath(input.project, plan, input.doc);
    let rel = found.rel;
    // A document that does not exist yet has the hash of the empty text, as plan.docs.get reports.
    const before = found.exists ? (this.readText(rel) ?? "") : "";
    if (input.baseHash && input.baseHash !== sha256Hex(before)) {
      throw fail(
        "PLAN_DOC_CHANGED",
        `${rel} changed since you read it`,
        "Read the file again, apply your edit to the new text and retry with its hash.",
        { path: rel },
      );
    }
    if (!found.exists && input.doc !== "plan") {
      const node = resolveNode(this.loadOutline(input.project, plan), input.doc);
      rel = this.createNodeDoc(input.project, plan, node.id, node.title);
    }
    const current = this.readText(rel) ?? "";
    const file = MarkdownFile.parse(current);
    file.setBody(input.body);
    const text = file.toString();
    this.lib.writeFile(rel, text);
    return { path: rel, hash: sha256Hex(text) };
  }

  // Insights -----------------------------------------------------------------------------------

  noteInsight(input: { project: string; plan?: string | undefined; target: string; text: string }) {
    this.lib.getProject(input.project);
    const date = localDate(this.now());
    const block = `i-${ulid().slice(-10)}`;
    if (input.target === "project") {
      const path = `${this.projectDir(input.project)}/insights.md`;
      this.writeInsight(path, date, input.text, block, "Einsichten");
      return {
        path,
        block,
        place: "project" as const,
        summary: "Noted in the insights of the project.",
      };
    }
    const plan = this.resolvePlan(input.project, input.plan);
    if (input.target === "plan") {
      const path = `${this.planDir(input.project, plan)}/plan.md`;
      this.writeInsight(path, date, input.text, block);
      return { path, block, place: "plan" as const, summary: "Noted in the planning document." };
    }

    const outline = this.loadOutline(input.project, plan);
    const target = resolveNode(outline, input.target);
    const docs = this.nodeDocs(input.project, plan);
    // The nearest document up the chain takes the paragraph (docs/decisions/0017-outline-and-section-files.md); a chapter always has one.
    const byId = new Map(outline.nodes.map((n) => [n.id, n]));
    let owner = target.id;
    let path = docs.get(owner);
    for (
      let at = byId.get(target.id);
      !path && at;
      at = at.parent ? byId.get(at.parent) : undefined
    ) {
      owner = at.id;
      path = docs.get(at.id);
      if (!path && at.parent === null) {
        path = this.createNodeDoc(input.project, plan, at.id, at.title);
      }
    }
    if (!path) throw fail("INTERNAL", "no document for the node", "Report this as a bug.");
    const needsLink = owner !== target.id && !input.text.includes(`[[${target.id}`);
    this.writeInsight(
      path,
      date,
      needsLink ? `${input.text.trim()} [[${target.id}]]` : input.text,
      block,
    );
    return {
      path,
      block,
      place: "node" as const,
      node: target.id,
      number: target.number,
      title: target.title,
      summary: `Noted in ${target.number}, ${target.title}.`,
    };
  }

  private writeInsight(rel: string, date: string, text: string, block: string, heading?: string) {
    const paragraph = insightParagraph(date, text, block);
    const raw = this.readText(rel);
    if (raw === undefined) {
      this.lib.writeFile(rel, appendParagraph(heading ? `# ${heading}\n` : "", paragraph));
      return;
    }
    const file = MarkdownFile.parse(raw);
    file.setBody(appendParagraph(file.body, paragraph));
    this.lib.writeFile(rel, file.toString());
  }

  /**
   * Every insight (a paragraph that carries a block id) of the plan, of the project's own
   * insights file and, without a plan, of all plans, newest first.
   */
  listInsights(input: { project: string; plan?: string | undefined; limit: number }): {
    hits: InsightHit[];
  } {
    this.lib.getProject(input.project);
    const plan = input.plan ? this.resolvePlan(input.project, input.plan) : undefined;
    const hits = this.projectParagraphs(input.project)
      .filter((p) => p.block && (plan === undefined || p.plan === plan || p.plan === undefined))
      .map((p) =>
        toHit(p, "links", p.plan ? `insight of plan ${p.plan}` : "insight of the project", 0),
      );
    // Equal dates keep their order in the files: the sort is stable and the later one comes first.
    const newestFirst = hits
      .map((hit, i) => ({ hit, i }))
      .sort((a, b) => (b.hit.date ?? "").localeCompare(a.hit.date ?? "") || b.i - a.i)
      .map((x) => x.hit);
    return { hits: newestFirst.slice(0, input.limit) };
  }

  async findInsights(input: {
    project: string;
    plan?: string | undefined;
    node?: string | undefined;
    refs?: string[] | undefined;
    query?: string | undefined;
    limit: number;
  }): Promise<{ hits: InsightHit[] }> {
    this.lib.getProject(input.project);
    if (!input.node && !input.query && !(input.refs && input.refs.length > 0)) {
      throw fail(
        "INVALID_INPUT",
        "find_insights needs a node, refs or a query",
        "Pass at least one of node, refs and query.",
      );
    }
    const paragraphs = this.projectParagraphs(input.project);
    const aliases = this.aliasMap(input.project);
    const resolve = (t: string): string => aliases.get(t) ?? t;

    let node: NumberedNode | undefined;
    let subtree = new Set<string>();
    let plan: string | undefined;
    if (input.node) {
      plan = this.resolvePlan(input.project, input.plan);
      const outline = this.loadOutline(input.project, plan);
      node = resolveNode(outline, input.node);
      subtree = new Set([node.id, ...descendants(outline, node.id)]);
    }
    const isNodeLink = (t: string): boolean => t.startsWith("k_") || aliases.has(t);

    const refs = new Set((input.refs ?? []).map((r) => r.replace(/^\[\[|\]\]$/g, "").trim()));
    for (const p of paragraphs) {
      if (p.node && subtree.has(p.node) && p.plan === plan) {
        for (const l of p.links) if (!isNodeLink(l)) refs.add(l);
      }
    }

    const hits: InsightHit[] = [];
    const seen = new Set<string>();
    const key = (p: PlacedParagraph): string => `${p.path}\0${p.text}`;
    for (const p of paragraphs) {
      const inDoc = Boolean(node && p.plan === plan && p.node && subtree.has(p.node));
      const nodeLinks = p.links.map(resolve).filter((l) => subtree.has(l));
      const shared = p.links.filter((l) => refs.has(l));
      if (!inDoc && nodeLinks.length === 0 && shared.length === 0) continue;
      const why: string[] = [];
      if (node && inDoc) why.push(`in the document of ${node.number} ${node.title}`);
      if (node && nodeLinks.length > 0) why.push(`links to the node ${node.number} ${node.title}`);
      if (shared.length > 0) {
        why.push(
          `shares ${shared.length} ${shared.length === 1 ? "link" : "links"}: ${shared.join(", ")}`,
        );
      }
      seen.add(key(p));
      hits.push(toHit(p, "links", why.join("; "), shared.length + new Set(nodeLinks).size));
    }
    hits.sort((a, b) => b.score - a.score || (b.date ?? "").localeCompare(a.date ?? ""));
    const out = hits.slice(0, input.limit);

    const query = input.query ?? (node ? node.title : "");
    if (out.length < input.limit && query) {
      const rest = paragraphs.filter((p) => !seen.has(key(p)));
      const scores =
        (await this.rank?.(
          query,
          rest.map((p) => p.text),
        )) ??
        lexicalScores(
          query,
          rest.map((p) => p.text),
        );
      const ranked = rest
        .map((p, i) => ({ p, s: scores[i] ?? 0 }))
        .filter((r) => r.s >= SEMANTIC_FLOOR)
        .sort((a, b) => b.s - a.s || (b.p.date ?? "").localeCompare(a.p.date ?? ""));
      for (const r of ranked.slice(0, input.limit - out.length)) {
        out.push(toHit(r.p, "semantic", `similar in text to "${query.slice(0, 60)}"`, round(r.s)));
      }
    }
    return { hits: out };
  }
}

const SEMANTIC_FLOOR = 0.25;
const round = (n: number): number => Math.round(n * 1000) / 1000;

function toHit(
  p: PlacedParagraph,
  stage: "links" | "semantic",
  why: string,
  score: number,
): InsightHit {
  return {
    path: p.path,
    ...(p.block ? { block: p.block } : {}),
    ...(p.date ? { date: p.date } : {}),
    text: p.text,
    stage,
    why,
    score,
  };
}

/** Share of the query words (four letters or more) that occur in the text, by stem. */
export function lexicalScores(query: string, texts: string[]): number[] {
  const terms = [...new Set(words(query).filter((w) => [...w].length >= 4))].map((w) => stems(w));
  if (terms.length === 0) return texts.map(() => 0);
  return texts.map((t) => {
    const have = new Set(words(t).flatMap(stems));
    return terms.filter((s) => s.some((x) => have.has(x))).length / terms.length;
  });
}
