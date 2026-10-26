import {
  pandocSetup,
  pandocStatus,
  type Registry,
  textsCreate,
  textsExport,
  textsGet,
  textsList,
  textsUpdate,
} from "@citegeist/ops";
import { citedKeys } from "@citegeist/schema";
import type { CoreEvent } from "../lib/core";
import type { MockData } from "../mock/fixtures";
import { pseudoHash } from "../planning/mock";

interface MockJob {
  id: string;
  status: "running" | "succeeded" | "failed";
  createdAt: string;
  updatedAt: string;
  progress?: number;
  result?: unknown;
}

export interface MockText {
  title: string;
  style?: string;
  lang?: string;
  body: string;
}

export interface TextsStore {
  /** Texts by project slug, then by text slug. */
  texts: Map<string, Map<string, MockText>>;
  pandoc: { found: boolean; version: string; installable: boolean };
  pdfEngine: string | undefined;
}

const STORES = new WeakMap<MockData, TextsStore>();

const KAPITEL = `# Soziale Systeme als Ausgangspunkt

Luhmann setzt Kommunikation und nicht Handlung als Grundelement sozialer Systeme [@luhmann1984soziale, S. 31]. Damit unterscheidet sich sein Ansatz von der Handlungstheorie, die Habermas ausarbeitet [vgl. @habermas1981theorie].

Plattformen lassen sich dann als Orte beschreiben, an denen Anschlusskommunikation organisiert wird. Das Argument ist noch nicht belegt [@gillespie2018custodians].
`;

const CHAPTER_EN = `# Social systems as a starting point

Luhmann takes communication, not action, as the basic element of social systems [@luhmann1984soziale, p. 31]. This sets his approach apart from the theory of action that Habermas develops [cf. @habermas1981theorie].

Platforms can then be described as places where connecting communication is organized. The argument is not yet substantiated [@gillespie2018custodians].
`;

/** The texts of the mock library, one per project at most, and the state of Pandoc. */
export function textsStoreFor(data: MockData): TextsStore {
  let store = STORES.get(data);
  if (!store) {
    store = {
      texts: new Map([
        [
          "phd-proposal",
          new Map([
            data.lang === "en"
              ? ["chapter-2", { title: "Chapter 2", body: CHAPTER_EN }]
              : ["kapitel-2", { title: "Kapitel 2", body: KAPITEL }],
          ]),
        ],
      ]),
      pandoc: { found: true, version: "3.12.1", installable: true },
      pdfEngine: undefined,
    };
    STORES.set(data, store);
  }
  return store;
}

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
function random(length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) out += CROCKFORD[Math.floor(Math.random() * CROCKFORD.length)];
  return out;
}

function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/ä/g, "ae")
      .replace(/ö/g, "oe")
      .replace(/ü/g, "ue")
      .replace(/ß/g, "ss")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "untitled"
  );
}

const fileOf = (t: MockText): string =>
  `---\ntitle: ${t.title}\n${t.style ? `style: ${t.style}\n` : ""}${t.lang ? `lang: ${t.lang}\n` : ""}---\n\n${t.body}`;

/** Texts and Pandoc of the core against fixture data; the export writes no file. */
export function bindTextsMock(
  registry: Registry,
  data: MockData,
  emit: (event: CoreEvent) => void,
  jobs: Map<string, MockJob>,
  delayMs: number,
): Registry {
  const store = textsStoreFor(data);
  const changed = (project: string, slug: string) =>
    emit({ type: "change", path: `projects/${project}/texts/${slug}.md`, external: false });
  const requireProject = (slug: string) => {
    if (!data.projects.has(slug))
      throw new Error(`PROJECT_NOT_FOUND: no project with slug '${slug}'`);
  };
  const textsOf = (project: string): Map<string, MockText> => {
    requireProject(project);
    let map = store.texts.get(project);
    if (!map) {
      map = new Map();
      store.texts.set(project, map);
    }
    return map;
  };
  const need = (project: string, slug: string): MockText => {
    const found = textsOf(project).get(slug);
    if (!found) {
      throw new Error(`TEXT_NOT_FOUND: project '${project}' has no text '${slug}'`);
    }
    return found;
  };
  const unknownOf = (body: string) => {
    const cited = citedKeys(body);
    return { cited, unknown: cited.filter((k) => !data.items.has(k)) };
  };
  const resolved = (project: string, t: MockText) => {
    const p = data.projects.get(project)?.frontmatter;
    return {
      style: t.style ?? p?.style ?? "apa",
      lang: t.lang ?? p?.ai_language ?? p?.locale ?? (data.lang === "en" ? "en-US" : "de-DE"),
    };
  };

  return registry
    .bind(textsList, async (_ctx, input) => ({
      texts: [...textsOf(input.project)].map(([slug, t]) => ({
        text: slug,
        title: t.title,
        path: `projects/${input.project}/texts/${slug}.md`,
        ...(t.style ? { style: t.style } : {}),
        ...(t.lang ? { lang: t.lang } : {}),
        words: t.body.match(/[\p{L}\p{N}]+/gu)?.length ?? 0,
        citations: citedKeys(t.body).length,
        updated: new Date().toISOString(),
      })),
    }))
    .bind(textsGet, async (_ctx, input) => {
      const t = need(input.project, input.text);
      return {
        text: input.text,
        path: `projects/${input.project}/texts/${input.text}.md`,
        title: t.title,
        ...(t.style ? { style: t.style } : {}),
        ...(t.lang ? { lang: t.lang } : {}),
        resolved: resolved(input.project, t),
        body: t.body,
        hash: pseudoHash(fileOf(t)),
        ...unknownOf(t.body),
      };
    })
    .bind(textsCreate, async (_ctx, input) => {
      const texts = textsOf(input.project);
      let slug = input.slug ?? slugify(input.title);
      for (let n = 2; !input.slug && texts.has(slug); n++) slug = `${slugify(input.title)}-${n}`;
      if (texts.has(slug)) throw new Error(`TEXT_EXISTS: project already has a text '${slug}'`);
      const text: MockText = {
        title: input.title,
        ...(input.style ? { style: input.style } : {}),
        ...(input.lang ? { lang: input.lang } : {}),
        body: input.body,
      };
      texts.set(slug, text);
      changed(input.project, slug);
      return {
        text: slug,
        path: `projects/${input.project}/texts/${slug}.md`,
        hash: pseudoHash(fileOf(text)),
      };
    })
    .bind(textsUpdate, async (_ctx, input) => {
      const t = need(input.project, input.text);
      if (input.baseHash && input.baseHash !== pseudoHash(fileOf(t))) {
        throw new Error(
          `TEXT_CHANGED: projects/${input.project}/texts/${input.text}.md changed since you read it`,
        );
      }
      if (input.body !== undefined) t.body = input.body;
      if (input.title !== undefined) t.title = input.title;
      if (input.style !== undefined) {
        if (input.style === "") delete t.style;
        else t.style = input.style;
      }
      if (input.lang !== undefined) {
        if (input.lang === "") delete t.lang;
        else t.lang = input.lang;
      }
      changed(input.project, input.text);
      return {
        path: `projects/${input.project}/texts/${input.text}.md`,
        hash: pseudoHash(fileOf(t)),
        ...unknownOf(t.body),
      };
    })
    .bind(textsExport, async (_ctx, input) => {
      const t = need(input.project, input.text);
      if (!store.pandoc.found) {
        throw new Error("PANDOC_MISSING: Pandoc was not found on this Mac.");
      }
      if (input.format === "pdf" && !store.pdfEngine) {
        throw new Error(
          "PDF_ENGINE_MISSING: A PDF needs a LaTeX engine or Typst, and none was found.",
        );
      }
      const settings = resolved(input.project, t);
      const ext = input.format === "latex" ? "zip" : input.format;
      const path = `projects/${input.project}/exports/${input.text}.${ext}`;
      return {
        path,
        absolutePath: `/Users/alex/Citegeist/${path}`,
        format: input.format,
        bytes: 24_000,
        style: input.style ?? settings.style,
        lang: input.lang ?? settings.lang,
        ...unknownOf(t.body),
        warnings: [],
        pandoc: store.pandoc.version,
        ...(input.format === "pdf" && store.pdfEngine ? { engine: store.pdfEngine } : {}),
      };
    })
    .bind(pandocStatus, async () => ({
      found: store.pandoc.found,
      ...(store.pandoc.found
        ? {
            path: "/opt/homebrew/bin/pandoc",
            version: store.pandoc.version,
            source: "path" as const,
          }
        : {}),
      pinned: "3.12.1",
      installable: store.pandoc.installable,
      ...(store.pdfEngine ? { pdfEngine: store.pdfEngine } : {}),
    }))
    .bind(pandocSetup, async () => {
      const now = new Date().toISOString();
      const job: MockJob = {
        id: `j_${random(16)}`,
        status: "running",
        createdAt: now,
        updatedAt: now,
        progress: 0.4,
      };
      jobs.set(job.id, job);
      setTimeout(
        () => {
          store.pandoc.found = true;
          job.status = "succeeded";
          job.progress = 1;
          job.updatedAt = new Date().toISOString();
        },
        Math.max(5, delayMs / 3),
      );
      return { job: job.id };
    });
}
