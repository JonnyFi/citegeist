import {
  type InsightHit,
  insightsFind,
  insightsList,
  insightsNote,
  itemsResolve,
  type NumberedNode,
  outlineApply,
  outlineGet,
  planDocsGet,
  planDocsUpdate,
  plansCreate,
  plansList,
  type Registry,
} from "@citegeist/ops";
import type { NodeStatus, OutlineNode, PlanTemplate } from "@citegeist/schema";
import type { Lang } from "../i18n";
import type { CoreEvent } from "../lib/core";
import { classifyIdentifier } from "../lib/identifier";
import { suggestMockCitekey } from "../mock/citekey";
import type { MockData } from "../mock/fixtures";
import { linkTargets, parseInsights } from "./insights";
import { childrenOf, normalizeOrder, numberNodes, slugify, subtreeIds } from "./outline";

/** One plan of the mock library: its outline and the text of its documents. */
export interface MockPlan {
  slug: string;
  title: string;
  template?: PlanTemplate;
  created: string;
  nodes: OutlineNode[];
  /** File names of node documents by node id (`nodes/<name>.md`). Chapters always have one. */
  files: Map<string, string>;
  /** Text by document key: "plan" or a node id. */
  docs: Map<string, string>;
}

export interface PlanStore {
  /** Language of the texts the mock writes: summaries, reasons and the templates. */
  lang: Lang;
  /** Plans by project slug, in creation order. */
  plans: Map<string, MockPlan[]>;
  /** Text of `projects/<project>/insights.md`. */
  insights: Map<string, string>;
}

const STORES = new WeakMap<MockData, PlanStore>();

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
function random(length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) out += CROCKFORD[Math.floor(Math.random() * CROCKFORD.length)];
  return out;
}

/** A 64 character hex digest. Not a real sha256, but stable and different for different texts. */
export function pseudoHash(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  const parts: string[] = [];
  for (let round = 0; round < 8; round++) {
    for (let i = 0; i < text.length; i++) {
      a = Math.imul(a ^ text.charCodeAt(i), 0x01000193) >>> 0;
      b = (Math.imul(b, 31) + a) >>> 0;
    }
    parts.push(a.toString(16).padStart(8, "0"));
    a = (a + b + round) >>> 0;
  }
  return parts.join("");
}

interface TemplateNode {
  title: string;
  purpose: string;
  children?: Array<{ title: string; purpose: string }>;
}

const TEMPLATES_EN: Record<PlanTemplate, TemplateNode[]> = {
  expose: [
    {
      title: "Introduction",
      purpose: "Presents the problem and its relevance.",
      children: [
        { title: "Problem statement", purpose: "Names the gap the project responds to." },
        { title: "Research questions", purpose: "States the questions that guide the project." },
      ],
    },
    { title: "State of research", purpose: "Places the project in the existing literature." },
    { title: "Theoretical framework", purpose: "Fixes the concepts the work uses." },
    { title: "Method", purpose: "Describes material, procedure and analysis." },
    { title: "Timeline", purpose: "Spreads the work steps over the available time." },
  ],
  imrad: [
    { title: "Introduction", purpose: "Presents background, gap and research question." },
    { title: "Methods", purpose: "Describes data and procedure so that others can repeat it." },
    { title: "Results", purpose: "Reports what was found, without interpreting it." },
    { title: "Discussion", purpose: "Interprets the results and names their limits." },
  ],
};

/** Texts the mock writes itself, by language. */
const TX = {
  de: {
    insightsHeading: "# Einsichten\n",
    notedProject: "Notiert in den Einsichten des Projekts",
    notedPlan: (title: string) => `Notiert im Planungsdokument ${title}`,
    notedNode: (number: string, title: string) => `Notiert in ${number}, ${title}`,
    whyInNode: (number: string | undefined) => `Im Dokument von ${number} oder mit Link darauf`,
    whyShared: (n: number) => `${n} gemeinsame Links`,
    whyQuery: "Text ähnlich der Suche",
    whyProject: "Einsicht des Projekts",
    planDoc: "Planungsdokument",
    projectInsights: "Einsichten des Projekts",
    abstractOf: (title: string) => `Zusammenfassung von ${title}.`,
  },
  en: {
    insightsHeading: "# Insights\n",
    notedProject: "Noted in the project's insights",
    notedPlan: (title: string) => `Noted in the planning document ${title}`,
    notedNode: (number: string, title: string) => `Noted in ${number}, ${title}`,
    whyInNode: (number: string | undefined) => `In the document of ${number} or linked to it`,
    whyShared: (n: number) => `${n} shared links`,
    whyQuery: "Text similar to the search",
    whyProject: "Insight of the project",
    planDoc: "Planning document",
    projectInsights: "Project insights",
    abstractOf: (title: string) => `Summary of ${title}.`,
  },
} as const;

const TEMPLATES: Record<PlanTemplate, TemplateNode[]> = {
  expose: [
    {
      title: "Einleitung",
      purpose: "Stellt Problem und Relevanz vor.",
      children: [
        { title: "Problemstellung", purpose: "Benennt die Lücke, auf die das Vorhaben antwortet." },
        { title: "Forschungsfragen", purpose: "Formuliert die Fragen, die das Projekt leiten." },
      ],
    },
    { title: "Forschungsstand", purpose: "Ordnet das Vorhaben in die vorhandene Literatur ein." },
    {
      title: "Theoretischer Rahmen",
      purpose: "Legt die Begriffe fest, mit denen gearbeitet wird.",
    },
    { title: "Methodik", purpose: "Beschreibt Material, Vorgehen und Auswertung." },
    { title: "Zeitplan", purpose: "Verteilt die Arbeitsschritte auf die verfügbare Zeit." },
  ],
  imrad: [
    { title: "Einleitung", purpose: "Stellt Hintergrund, Lücke und Fragestellung vor." },
    {
      title: "Methoden",
      purpose: "Beschreibt Daten und Vorgehen so, dass man sie wiederholen kann.",
    },
    { title: "Ergebnisse", purpose: "Berichtet, was gefunden wurde, ohne zu deuten." },
    { title: "Diskussion", purpose: "Deutet die Ergebnisse und benennt Grenzen." },
  ],
};

function fromTemplate(
  template: PlanTemplate,
  lang: Lang,
): {
  nodes: OutlineNode[];
  files: Map<string, string>;
} {
  const nodes: OutlineNode[] = [];
  const files = new Map<string, string>();
  (lang === "en" ? TEMPLATES_EN : TEMPLATES)[template].forEach((chapter, i) => {
    const id = `k_${random(10)}`;
    nodes.push({
      id,
      title: chapter.title,
      parent: null,
      order: i + 1,
      purpose: chapter.purpose,
      status: "idea",
      questions: [],
    });
    files.set(id, `${slugify(chapter.title)}`);
    chapter.children?.forEach((section, j) => {
      nodes.push({
        id: `k_${random(10)}`,
        title: section.title,
        parent: id,
        order: j + 1,
        purpose: section.purpose,
        status: "idea",
        questions: [],
      });
    });
  });
  return { nodes, files };
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

const planDir = (project: string, plan: string) => `projects/${project}/plans/${plan}`;

export function docPath(project: string, plan: MockPlan, key: string): string {
  if (key === "plan") return `${planDir(project, plan.slug)}/plan.md`;
  return `${planDir(project, plan.slug)}/nodes/${plan.files.get(key) ?? key}.md`;
}

function seed(data: MockData): PlanStore {
  const store: PlanStore = { lang: data.lang, plans: new Map(), insights: new Map() };
  if (!data.projects.has("phd-proposal")) return store;

  const k = {
    intro: "k_01JC2C9KQ1",
    problem: "k_01JC2C9KQ2",
    questions: "k_01JC2C9KQ3",
    luhmann: "k_01JC2C9KQ4",
    anschluss: "k_01JC6A1B2C",
    autopoiesis: "k_01JC6A1B2D",
    platforms: "k_01JC2C9KQ5",
    method: "k_01JC2C9KQ6",
  };
  const node = (
    id: string,
    title: string,
    parent: string | null,
    order: number,
    status: NodeStatus,
    purpose?: string,
    questions: string[] = [],
  ): OutlineNode => ({
    id,
    title,
    parent,
    order,
    status,
    questions,
    ...(purpose ? { purpose } : {}),
  });
  const card = data.cards[0]?.frontmatter.id ?? "c_01JB8Z3Q00";

  const seedGerman = (): { plans: MockPlan[]; insights: string } => {
    const proposal: MockPlan = {
      slug: "expose",
      title: "Exposé",
      template: "expose",
      created: "2026-10-12T09:00:00.000Z",
      nodes: [
        node(k.intro, "Einleitung", null, 1, "solid", "Stellt Problem und Relevanz vor.", ["q1"]),
        node(k.problem, "Problemstellung", k.intro, 1, "draft"),
        node(k.questions, "Forschungsfragen", k.intro, 2, "draft", undefined, ["q1", "q2"]),
        node(
          k.luhmann,
          "Luhmanns Kommunikationsbegriff",
          null,
          2,
          "draft",
          "Führt den Begriff ein, auf dem Kapitel 3 aufbaut.",
          ["q1"],
        ),
        node(k.anschluss, "Anschlusskommunikation", k.luhmann, 1, "idea"),
        node(
          k.autopoiesis,
          "Autopoiesis",
          k.luhmann,
          2,
          "draft",
          "Klärt, was Selbstreferenz hier meint.",
          ["q2"],
        ),
        node(
          k.platforms,
          "Plattformen als soziale Systeme",
          null,
          3,
          "idea",
          "Wendet den Begriff auf Plattformen an.",
          ["q1"],
        ),
        node(k.method, "Methodik", null, 4, "idea"),
      ],
      files: new Map([
        [k.intro, "einleitung"],
        [k.luhmann, "kommunikationsbegriff"],
        [k.autopoiesis, "autopoiesis"],
        [k.platforms, "plattformen"],
        [k.method, "methodik"],
      ]),
      docs: new Map([
        [
          "plan",
          "# Exposé\n\nDas Exposé führt von Luhmanns Kommunikationsbegriff zu Plattformen.\n\n2026-10-20: Kapitel 2 und 3 teilen sich die Frage, ob Rankings Anschlusskommunikation sind. ^i-01JC5Q2M8T",
        ],
        [k.intro, "Die Einleitung stellt die Frage vor, siehe [[habermas1981theorie]].\n"],
        [
          k.luhmann,
          `Kommunikation ist das Element sozialer Systeme, siehe [[luhmann1984soziale]] und die Karte [[${card}]].\n\n2026-10-18: Die Anschlussfähigkeit ist das, was [[${k.anschluss}]] von bloßer Mitteilung trennt. ^i-01JC5Q2M9A\n\n2026-10-21: Selbstreferenz in [[luhmann1984soziale]] und [[latour2005reassembling]] meint nicht dasselbe. ^i-01JC5Q2MAB`,
        ],
        [
          k.autopoiesis,
          "Autopoiesis stammt aus der Biologie, [[luhmann1984soziale]] überträgt sie auf Kommunikation.\n",
        ],
        [k.platforms, ""],
        [k.method, ""],
      ]),
    };

    const m = (id: string, title: string, parent: string | null, order: number): OutlineNode =>
      node(id, title, parent, order, "idea");
    const paper: MockPlan = {
      slug: "paper-plattformen",
      title: "Paper Plattformen",
      template: "imrad",
      created: "2026-10-15T09:00:00.000Z",
      nodes: [
        m("k_01JC9PAPER1", "Einleitung", null, 1),
        m("k_01JC9PAPER2", "Methoden", null, 2),
        m("k_01JC9PAPER3", "Ergebnisse", null, 3),
        m("k_01JC9PAPER4", "Diskussion", null, 4),
      ],
      files: new Map([
        ["k_01JC9PAPER1", "einleitung"],
        ["k_01JC9PAPER2", "methoden"],
        ["k_01JC9PAPER3", "ergebnisse"],
        ["k_01JC9PAPER4", "diskussion"],
      ]),
      docs: new Map([["plan", "# Paper Plattformen\n"]]),
    };

    return {
      plans: [proposal, paper],
      insights:
        "# Einsichten\n\n2026-10-22: Gillespies Feedbackschleife bei Rankings ist ein Fall von Anschlusskommunikation im Sinne von [[luhmann1984soziale]]. ^i-01JC5Q2MBC\n",
    };
  };
  const seedEnglish = (): { plans: MockPlan[]; insights: string } => {
    const proposal: MockPlan = {
      slug: "expose",
      title: "Proposal",
      template: "expose",
      created: "2026-10-12T09:00:00.000Z",
      nodes: [
        node(
          k.intro,
          "Introduction",
          null,
          1,
          "solid",
          "Introduces the problem and its relevance.",
          ["q1"],
        ),
        node(k.problem, "Problem statement", k.intro, 1, "draft"),
        node(k.questions, "Research questions", k.intro, 2, "draft", undefined, ["q1", "q2"]),
        node(
          k.luhmann,
          "Luhmann's concept of communication",
          null,
          2,
          "draft",
          "Introduces the concept that chapter 3 builds on.",
          ["q1"],
        ),
        node(k.anschluss, "Connecting communication", k.luhmann, 1, "idea"),
        node(
          k.autopoiesis,
          "Autopoiesis",
          k.luhmann,
          2,
          "draft",
          "Clarifies what self-reference means here.",
          ["q2"],
        ),
        node(
          k.platforms,
          "Platforms as social systems",
          null,
          3,
          "idea",
          "Applies the concept to platforms.",
          ["q1"],
        ),
        node(k.method, "Method", null, 4, "idea"),
      ],
      files: new Map([
        [k.intro, "introduction"],
        [k.luhmann, "communication-concept"],
        [k.autopoiesis, "autopoiesis"],
        [k.platforms, "platforms"],
        [k.method, "method"],
      ]),
      docs: new Map([
        [
          "plan",
          "# Proposal\n\nThe proposal leads from Luhmann's concept of communication to platforms.\n\n2026-10-20: Chapters 2 and 3 share the question of whether rankings are connecting communication. ^i-01JC5Q2M8T",
        ],
        [k.intro, "The introduction presents the question, see [[habermas1981theorie]].\n"],
        [
          k.luhmann,
          `Communication is the element of social systems, see [[luhmann1984soziale]] and the card [[${card}]].\n\n2026-10-18: Connectivity is what separates [[${k.anschluss}]] from a mere utterance. ^i-01JC5Q2M9A\n\n2026-10-21: Self-reference in [[luhmann1984soziale]] and [[latour2005reassembling]] does not mean the same thing. ^i-01JC5Q2MAB`,
        ],
        [
          k.autopoiesis,
          "Autopoiesis comes from biology, and [[luhmann1984soziale]] transfers it to communication.\n",
        ],
        [k.platforms, ""],
        [k.method, ""],
      ]),
    };

    const m = (id: string, title: string, parent: string | null, order: number): OutlineNode =>
      node(id, title, parent, order, "idea");
    const paper: MockPlan = {
      slug: "paper-platforms",
      title: "Platforms paper",
      template: "imrad",
      created: "2026-10-15T09:00:00.000Z",
      nodes: [
        m("k_01JC9PAPER1", "Introduction", null, 1),
        m("k_01JC9PAPER2", "Methods", null, 2),
        m("k_01JC9PAPER3", "Results", null, 3),
        m("k_01JC9PAPER4", "Discussion", null, 4),
      ],
      files: new Map([
        ["k_01JC9PAPER1", "introduction"],
        ["k_01JC9PAPER2", "methods"],
        ["k_01JC9PAPER3", "results"],
        ["k_01JC9PAPER4", "discussion"],
      ]),
      docs: new Map([["plan", "# Platforms paper\n"]]),
    };

    return {
      plans: [proposal, paper],
      insights:
        "# Insights\n\n2026-10-22: Gillespie's feedback loop in rankings is a case of connecting communication in the sense of [[luhmann1984soziale]]. ^i-01JC5Q2MBC\n",
    };
  };
  const seeded = data.lang === "en" ? seedEnglish() : seedGerman();
  store.plans.set("phd-proposal", seeded.plans);
  store.insights.set("phd-proposal", seeded.insights);
  return store;
}

export function planStoreFor(data: MockData): PlanStore {
  let store = STORES.get(data);
  if (!store) {
    store = seed(data);
    STORES.set(data, store);
  }
  return store;
}

export function plansOf(store: PlanStore, project: string): MockPlan[] {
  return store.plans.get(project) ?? [];
}

function pickPlan(store: PlanStore, project: string, slug: string | undefined): MockPlan {
  const plans = plansOf(store, project);
  if (slug) {
    const found = plans.find((p) => p.slug === slug);
    if (!found) throw new Error(`PLAN_NOT_FOUND: project '${project}' has no plan '${slug}'`);
    return found;
  }
  const [only] = plans;
  if (!only) throw new Error(`PLAN_NOT_FOUND: project '${project}' has no plan`);
  if (plans.length > 1) {
    throw new Error(
      `PLAN_AMBIGUOUS: project '${project}' has ${plans.length} plans, pass one of: ${plans
        .map((p) => p.slug)
        .join(", ")}`,
    );
  }
  return only;
}

function numbered(project: string, plan: MockPlan): NumberedNode[] {
  return numberNodes(plan.nodes).map((n) => {
    // chapters always have a document; a section has one once it has text
    const doc = n.parent === null || plan.docs.has(n.id) ? docPath(project, plan, n.id) : undefined;
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

/** The document that takes an insight about a node: its own, else the one of its chapter. */
function homeDoc(plan: MockPlan, id: string): string {
  let node = plan.nodes.find((n) => n.id === id);
  while (node) {
    if (node.parent === null || plan.docs.has(node.id)) return node.id;
    const parent = node.parent;
    node = plan.nodes.find((n) => n.id === parent);
  }
  return id;
}

export interface NotedInsight {
  path: string;
  block: string;
  place: "node" | "plan" | "project";
  node?: string;
  number?: string;
  title?: string;
  summary: string;
}

/** Appends an insight paragraph the way the core does: date first, block id last. */
export function noteInsightIn(
  store: PlanStore,
  project: string,
  planSlug: string | undefined,
  target: string,
  text: string,
): NotedInsight {
  const block = `i-${random(10)}`;
  const paragraph = `${today()}: ${text.trim()} ^${block}`;
  const append = (body: string) =>
    body.trim() ? `${body.trimEnd()}\n\n${paragraph}\n` : `${paragraph}\n`;

  if (target === "project") {
    store.insights.set(
      project,
      append(store.insights.get(project) ?? TX[store.lang].insightsHeading),
    );
    return {
      path: `projects/${project}/insights.md`,
      block,
      place: "project",
      summary: TX[store.lang].notedProject,
    };
  }
  const plan = pickPlan(store, project, planSlug);
  if (target === "plan") {
    plan.docs.set("plan", append(plan.docs.get("plan") ?? ""));
    return {
      path: docPath(project, plan, "plan"),
      block,
      place: "plan",
      summary: TX[store.lang].notedPlan(plan.title),
    };
  }
  const numbers = numberNodes(plan.nodes);
  const found = numbers.find((n) => n.id === target || n.number === target);
  if (!found) {
    throw new Error(`NODE_NOT_FOUND: plan '${plan.slug}' has no node '${target}'`);
  }
  const key = homeDoc(plan, found.id);
  plan.docs.set(key, append(plan.docs.get(key) ?? ""));
  const home = numbers.find((n) => n.id === key) ?? found;
  return {
    path: docPath(project, plan, key),
    block,
    place: "node",
    node: home.id,
    number: home.number,
    title: home.title,
    summary: TX[store.lang].notedNode(home.number, home.title),
  };
}

/** Takes an insight paragraph out again, as "Rückgängig" in the chat does. */
export function removeInsightIn(store: PlanStore, project: string, block: string): void {
  const strip = (body: string) =>
    body
      .split(/\n\s*\n/)
      .filter((chunk) => !chunk.includes(`^${block}`))
      .join("\n\n");
  for (const plan of plansOf(store, project)) {
    for (const [key, body] of plan.docs) plan.docs.set(key, strip(body));
  }
  const insights = store.insights.get(project);
  if (insights !== undefined) store.insights.set(project, strip(insights));
}

/** Every insight paragraph of a project with the file it sits in. */
export function allInsights(
  store: PlanStore,
  project: string,
  planSlug: string | undefined,
): Array<{ path: string; block: string; date?: string; text: string }> {
  const out: Array<{ path: string; block: string; date?: string; text: string }> = [];
  const plans = planSlug
    ? plansOf(store, project).filter((p) => p.slug === planSlug)
    : plansOf(store, project);
  for (const plan of plans) {
    for (const [key, body] of plan.docs) {
      for (const p of parseInsights(body)) {
        out.push({
          path: docPath(project, plan, key),
          block: p.block,
          ...(p.date ? { date: p.date } : {}),
          text: p.text,
        });
      }
    }
  }
  for (const p of parseInsights(store.insights.get(project) ?? "")) {
    out.push({
      path: `projects/${project}/insights.md`,
      block: p.block,
      ...(p.date ? { date: p.date } : {}),
      text: p.text,
    });
  }
  return out;
}

/**
 * The planning operations of the core against fixture data: plans from templates, the outline with
 * computed numbers, documents, and insights as dated paragraphs in those documents.
 */
export function bindPlanningMock(
  registry: Registry,
  data: MockData,
  emit: (event: CoreEvent) => void,
): Registry {
  const store = planStoreFor(data);
  const changed = (path: string) => emit({ type: "change", path, external: false });
  const requireProject = (slug: string) => {
    if (!data.projects.has(slug)) {
      throw new Error(`PROJECT_NOT_FOUND: no project with slug '${slug}'`);
    }
  };

  return registry
    .bind(plansList, async (_ctx, input) => {
      requireProject(input.project);
      return {
        plans: plansOf(store, input.project).map((p) => ({
          plan: p.slug,
          title: p.title,
          ...(p.template ? { template: p.template } : {}),
          path: docPath(input.project, p, "plan"),
          nodes: p.nodes.length,
        })),
      };
    })
    .bind(plansCreate, async (_ctx, input) => {
      requireProject(input.project);
      const plans = plansOf(store, input.project);
      if (plans.some((p) => p.slug === input.slug)) {
        throw new Error(
          `PLAN_EXISTS: project '${input.project}' already has a plan '${input.slug}'`,
        );
      }
      const built = input.template
        ? fromTemplate(input.template, store.lang)
        : { nodes: [], files: new Map() };
      const plan: MockPlan = {
        slug: input.slug,
        title: input.title,
        ...(input.template ? { template: input.template } : {}),
        created: new Date().toISOString(),
        nodes: built.nodes,
        files: built.files,
        docs: new Map([["plan", `# ${input.title}\n`]]),
      };
      for (const n of plan.nodes) if (n.parent === null) plan.docs.set(n.id, "");
      store.plans.set(input.project, [...plans, plan]);
      changed(docPath(input.project, plan, "plan"));
      return {
        project: input.project,
        plan: plan.slug,
        title: plan.title,
        path: docPath(input.project, plan, "plan"),
        outline: `${planDir(input.project, plan.slug)}/outline.yaml`,
        nodes: plan.nodes.length,
      };
    })
    .bind(outlineGet, async (_ctx, input) => {
      requireProject(input.project);
      const plan = pickPlan(store, input.project, input.plan);
      return {
        project: input.project,
        plan: plan.slug,
        title: plan.title,
        nodes: numbered(input.project, plan),
      };
    })
    .bind(outlineApply, async (_ctx, input) => {
      requireProject(input.project);
      const plan = pickPlan(store, input.project, input.plan);
      let nodes = plan.nodes.map((n) => ({ ...n }));
      const added: string[] = [];
      const need = (id: string) => {
        const found = nodes.find((n) => n.id === id);
        if (!found) throw new Error(`NODE_NOT_FOUND: plan '${plan.slug}' has no node '${id}'`);
        return found;
      };
      const insert = (node: OutlineNode, position: number | undefined) => {
        const siblings = childrenOf(nodes, node.parent).filter((n) => n.id !== node.id);
        const at = Math.min(Math.max((position ?? siblings.length + 1) - 1, 0), siblings.length);
        siblings.splice(at, 0, node);
        const order = new Map(siblings.map((n, i) => [n.id, i + 1]));
        nodes = [
          ...nodes
            .filter((n) => n.id !== node.id)
            .map((n) => ({ ...n, order: order.get(n.id) ?? n.order })),
          { ...node, order: order.get(node.id) ?? 1 },
        ];
      };

      for (const op of input.ops) {
        if (op.op === "add") {
          if (op.parent) need(op.parent);
          const id = `k_${random(10)}`;
          added.push(id);
          insert(
            {
              id,
              title: op.title,
              parent: op.parent,
              order: 1,
              ...(op.purpose ? { purpose: op.purpose } : {}),
              status: op.status ?? "idea",
              questions: op.questions ?? [],
            },
            op.position,
          );
          plan.files.set(id, `${slugify(op.title)}-${id.slice(2, 6).toLowerCase()}`);
          if (!op.parent) plan.docs.set(id, "");
        } else if (op.op === "update") {
          need(op.id);
          nodes = nodes.map((n) => {
            if (n.id !== op.id) return n;
            const { purpose: kept, ...base } = n;
            const purpose = op.purpose === undefined ? kept : (op.purpose ?? undefined);
            return {
              ...base,
              ...(op.title ? { title: op.title } : {}),
              ...(op.status ? { status: op.status } : {}),
              ...(op.questions ? { questions: op.questions } : {}),
              ...(purpose ? { purpose } : {}),
            };
          });
        } else if (op.op === "move") {
          const node = need(op.id);
          if (op.parent) {
            need(op.parent);
            if (subtreeIds(nodes, node.id).has(op.parent)) {
              throw new Error("OUTLINE_CYCLE: a node cannot move below itself");
            }
          }
          insert({ ...node, parent: op.parent }, op.position);
        } else {
          const node = need(op.id);
          const gone = subtreeIds(nodes, node.id);
          const withText = [...gone].filter((id) => (plan.docs.get(id) ?? "").trim() !== "");
          const linked = [...plan.docs.entries()].some(
            ([key, body]) => !gone.has(key) && linkTargets(body).some((t) => gone.has(t)),
          );
          if ((withText.length > 0 || linked) && !input.force) {
            throw new Error(
              `OUTLINE_REMOVE_NEEDS_FORCE: '${node.title}' has a document with text or incoming links`,
            );
          }
          nodes = nodes.filter((n) => !gone.has(n.id));
          for (const id of gone) {
            plan.docs.delete(id);
            plan.files.delete(id);
          }
        }
        nodes = normalizeOrder(nodes);
      }
      plan.nodes = nodes;
      changed(`${planDir(input.project, plan.slug)}/outline.yaml`);
      return {
        project: input.project,
        plan: plan.slug,
        added,
        nodes: numbered(input.project, plan),
      };
    })
    .bind(planDocsGet, async (_ctx, input) => {
      requireProject(input.project);
      const plan = pickPlan(store, input.project, input.plan);
      if (input.doc !== "plan" && !plan.nodes.some((n) => n.id === input.doc)) {
        throw new Error(`NODE_NOT_FOUND: plan '${plan.slug}' has no node '${input.doc}'`);
      }
      const body = plan.docs.get(input.doc) ?? "";
      return {
        path: docPath(input.project, plan, input.doc),
        body,
        hash: pseudoHash(body),
        exists: plan.docs.has(input.doc),
      };
    })
    .bind(planDocsUpdate, async (_ctx, input) => {
      requireProject(input.project);
      const plan = pickPlan(store, input.project, input.plan);
      if (input.doc !== "plan" && !plan.nodes.some((n) => n.id === input.doc)) {
        throw new Error(`NODE_NOT_FOUND: plan '${plan.slug}' has no node '${input.doc}'`);
      }
      const current = plan.docs.get(input.doc) ?? "";
      if (input.baseHash && plan.docs.has(input.doc) && input.baseHash !== pseudoHash(current)) {
        throw new Error("PLAN_DOC_CHANGED: the file changed since you read it");
      }
      plan.docs.set(input.doc, input.body);
      changed(docPath(input.project, plan, input.doc));
      return {
        path: docPath(input.project, plan, input.doc),
        hash: pseudoHash(input.body),
      };
    })
    .bind(insightsNote, async (_ctx, input) => {
      requireProject(input.project);
      const out = noteInsightIn(store, input.project, input.plan, input.target, input.text);
      changed(out.path);
      return {
        path: out.path,
        block: out.block,
        place: out.place,
        ...(out.node ? { node: out.node } : {}),
        ...(out.number ? { number: out.number } : {}),
        ...(out.title ? { title: out.title } : {}),
        summary: out.summary,
      };
    })
    .bind(insightsFind, async (_ctx, input) => {
      requireProject(input.project);
      const plans = plansOf(store, input.project);
      const plan = plans.length > 0 ? pickPlan(store, input.project, input.plan) : undefined;
      const all = allInsights(store, input.project, plan?.slug);
      const nodes = plan ? numbered(input.project, plan) : [];
      const wanted = input.node
        ? nodes.find((n) => n.id === input.node || n.number === input.node)
        : undefined;
      const below = wanted ? subtreeIds(nodes, wanted.id) : undefined;
      const refs = new Set(input.refs ?? []);
      const query = input.query?.trim().toLowerCase();

      const hits: InsightHit[] = [];
      for (const p of all) {
        const targets = linkTargets(p.text);
        const home = nodes.find((n) => n.doc === p.path);
        const inNode = below && ((home && below.has(home.id)) || targets.some((t) => below.has(t)));
        const shared = targets.filter((t) => refs.has(t)).length;
        const base = {
          path: p.path,
          block: p.block,
          ...(p.date ? { date: p.date } : {}),
          text: `${p.date ? `${p.date}: ` : ""}${p.text} ^${p.block}`,
        };
        if (inNode || shared > 0) {
          hits.push({
            ...base,
            stage: "links",
            why: inNode
              ? TX[store.lang].whyInNode(wanted?.number)
              : TX[store.lang].whyShared(shared),
            score: (inNode ? 2 : 0) + shared,
          });
        } else if (query ? p.text.toLowerCase().includes(query) : !wanted && refs.size === 0) {
          hits.push({
            ...base,
            stage: "semantic",
            why: query ? TX[store.lang].whyQuery : TX[store.lang].whyProject,
            score: 0.5,
          });
        }
      }
      hits.sort((a, b) => b.score - a.score || (b.date ?? "").localeCompare(a.date ?? ""));
      return { hits: hits.slice(0, input.limit) };
    })
    .bind(insightsList, async (_ctx, input) => {
      requireProject(input.project);
      const plans = plansOf(store, input.project);
      const plan = plans.length > 0 ? pickPlan(store, input.project, input.plan) : undefined;
      const nodes = plan ? numbered(input.project, plan) : [];
      const hits: InsightHit[] = allInsights(store, input.project, plan?.slug).map((p) => {
        const home = nodes.find((n) => n.doc === p.path);
        return {
          path: p.path,
          block: p.block,
          ...(p.date ? { date: p.date } : {}),
          text: `${p.date ? `${p.date}: ` : ""}${p.text} ^${p.block}`,
          stage: "links" as const,
          why: home
            ? `${home.number} ${home.title}`
            : p.path.endsWith("/plan.md")
              ? TX[store.lang].planDoc
              : TX[store.lang].projectInsights,
          score: 0,
        };
      });
      hits.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
      return { hits: hits.slice(0, input.limit) };
    })
    .bind(itemsResolve, async (_ctx, input) => {
      const item = data.items.get(input.citekey);
      if (!item) throw new Error(`ITEM_NOT_FOUND: no item with citekey '${input.citekey}'`);
      const changedFields: string[] = [];
      let suggestedCitekey: string | undefined;
      if (input.identifier) {
        const { kind, value } = classifyIdentifier(input.identifier);
        if (!["doi", "arxiv", "isbn", "pmid", "url"].includes(kind)) {
          throw new Error(
            `INVALID_IDENTIFIER: '${input.identifier}' is not a DOI, arXiv id, ISBN, PMID or URL`,
          );
        }
        const before = item.frontmatter;
        const next: Record<string, unknown> = { ...before };
        if (kind === "doi") next.DOI = value.replace(/^.*?(10\.)/i, "$1").toLowerCase();
        if (kind === "isbn") next.ISBN = value.replace(/^isbn:?\s*/i, "");
        if (kind === "url") next.URL = value;
        if (kind === "doi" || kind === "isbn") changedFields.push(kind === "doi" ? "DOI" : "ISBN");
        if (!before.author?.length) {
          next.author = [{ family: "Muster", given: "Maria" }];
          changedFields.push("author");
        }
        if (before.issued === undefined) {
          next.issued = 2020;
          changedFields.push("issued");
        }
        item.frontmatter = next as typeof before;
        suggestedCitekey = suggestMockCitekey(before, item.frontmatter, data.items);
        changed(`items/${input.citekey}/${input.citekey}.md`);
        return {
          citekey: input.citekey,
          changed: changedFields,
          ...(suggestedCitekey ? { suggestedCitekey } : {}),
        };
      }
      const fm = item.frontmatter;
      if (!fm.publisher && fm.type === "book") {
        item.frontmatter = { ...fm, publisher: "Suhrkamp" };
        changedFields.push("publisher");
      }
      if (!fm.abstract) {
        item.frontmatter = { ...item.frontmatter, abstract: TX[store.lang].abstractOf(fm.title) };
        changedFields.push("abstract");
      }
      if (changedFields.length > 0) changed(`items/${input.citekey}/${input.citekey}.md`);
      return { citekey: input.citekey, changed: changedFields };
    });
}
