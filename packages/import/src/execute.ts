import type { ImportResult } from "@citegeist/ops";
import { buildFrontmatter, mergeFrontmatter } from "./merge.js";
import { isPdf, type Plan, type PlannedItem } from "./plan.js";
import type { ImportHost, ImportProblem, SourceAttachment, SourceNote } from "./types.js";
import { errorMessage, normalizeText } from "./util.js";
import { annotationToCard } from "./zotero/annotations.js";

/** Calls an operation of the registry as the actor "system". */
export type Call = (name: string, input: unknown) => Promise<unknown>;

export interface ExecuteDeps {
  host: ImportHost;
  call: Call;
  progress(value: number, message?: string): void;
  signal?: AbortSignal | undefined;
}

const MAX_PROBLEMS = 200;

interface Out {
  created: string[];
  merged: string[];
  skipped: number;
  attachments: number;
  notes: number;
  cards: number;
  projects: string[];
  problems: ImportProblem[];
  problemCount: number;
}

function addProblem(out: Out, p: ImportProblem): void {
  out.problemCount++;
  if (out.problems.length < MAX_PROBLEMS) out.problems.push(p);
}

interface CardRow {
  body: { quote: string };
}

/**
 * Writes the plan: projects, items, files, cards, notes. Each item is independent, so a failure
 * is reported as a problem and the import goes on with the next one.
 */
export async function executePlan(plan: Plan, deps: ExecuteDeps): Promise<ImportResult> {
  const { call } = deps;
  const out: Out = {
    created: [],
    merged: [],
    skipped: 0,
    attachments: 0,
    notes: 0,
    cards: 0,
    projects: [],
    problems: plan.problems.filter((p) => p.severity !== "info").slice(0, MAX_PROBLEMS),
    problemCount: plan.problems.filter((p) => p.severity !== "info").length,
  };

  for (const project of plan.projectsToCreate) {
    try {
      await call("projects.create", { slug: project.slug, title: project.title, brief: "" });
      out.projects.push(project.slug);
    } catch (err) {
      addProblem(out, {
        code: "PROJECT_NOT_CREATED",
        severity: "error",
        message: `project ${project.slug}: ${errorMessage(err)}`,
      });
    }
  }

  const total = plan.items.length + plan.standaloneNotes.length || 1;
  let done = 0;
  for (const planned of plan.items) {
    if (deps.signal?.aborted) throw new Error("The operation was cancelled");
    deps.progress(
      done / total,
      `${done + 1} of ${total}: ${planned.item.draft.title.slice(0, 60)}`,
    );
    done++;
    if (planned.action === "skip") {
      out.skipped++;
      continue;
    }
    try {
      await importItem(plan, planned, deps, out);
    } catch (err) {
      addProblem(out, {
        code: "ITEM_FAILED",
        severity: "error",
        message: `${planned.item.draft.title.slice(0, 80)}: ${errorMessage(err)}`,
        ref: planned.item.ref,
      });
    }
  }

  for (const note of plan.standaloneNotes) {
    if (deps.signal?.aborted) throw new Error("The operation was cancelled");
    deps.progress(done / total, "notes");
    done++;
    try {
      const existing = await existingNoteTitles(call, note.title ?? "Zotero note");
      if (existing.has(note.title ?? "Zotero note")) continue;
      await call("notes.create", {
        title: note.title ?? "Zotero note",
        body: note.markdown,
        type: "permanent",
        projects: plan.options.project ? [plan.options.project] : [],
      });
      out.notes++;
    } catch (err) {
      addProblem(out, {
        code: "NOTE_FAILED",
        severity: "error",
        message: `note ${note.ref}: ${errorMessage(err)}`,
        ref: note.ref,
      });
    }
  }

  deps.progress(1, "done");
  return {
    provenance: plan.provenance,
    created: out.created,
    merged: out.merged,
    skipped: out.skipped,
    attachments: out.attachments,
    notes: out.notes,
    cards: out.cards,
    projects: out.projects,
    problems: out.problems,
    problemCount: out.problemCount,
  };
}

async function existingNoteTitles(call: Call, title: string): Promise<Set<string>> {
  const res = (await call("notes.list", { query: title, limit: 100 })) as {
    notes: { title: string }[];
  };
  return new Set(res.notes.map((n) => n.title));
}

async function importItem(
  plan: Plan,
  planned: PlannedItem,
  deps: ExecuteDeps,
  out: Out,
): Promise<void> {
  const { host, call } = deps;
  const { item, citekey } = planned;
  const common = {
    draft: item.draft,
    tag: plan.bundle.tag,
    now: plan.now,
    tags: [...new Set([...(item.draft.tags ?? []), ...planned.tags])],
    projects: planned.projects,
  };
  const isNew = planned.action === "create";
  if (isNew) {
    host.writeItem(buildFrontmatter({ ...common, citekey, dateAdded: item.dateAdded }), "");
    out.created.push(citekey);
  } else {
    const existing = host.readItem(citekey);
    const merged = mergeFrontmatter(existing.frontmatter, common);
    if (merged.changed) host.writeItem(merged.frontmatter, existing.body);
    if (!out.merged.includes(citekey)) out.merged.push(citekey);
  }

  const attached: { att: SourceAttachment; source: string }[] = [];
  if (plan.options.attachments) {
    for (const att of item.attachments) {
      if (att.missing) continue;
      try {
        const found = att.path ? { path: att.path } : att.resolve ? await att.resolve() : {};
        if (!found.path) {
          addProblem(out, {
            code: "ATTACHMENT_MISSING",
            severity: "warning",
            message: `${att.filename}: ${found.missing ?? "no file"}`,
            ref: item.ref,
          });
          continue;
        }
        const res = (await call("items.attach", {
          citekey,
          path: found.path,
          filename: att.filename,
          ...(att.url && /^https?:\/\//i.test(att.url) ? { url: att.url } : {}),
        })) as { source: string; added: boolean };
        if (res.added) out.attachments++;
        attached.push({ att, source: res.source });
      } catch (err) {
        addProblem(out, {
          code: "ATTACH_FAILED",
          severity: "warning",
          message: `${att.filename}: ${errorMessage(err)}`,
          ref: item.ref,
        });
      }
    }
  }

  if (plan.options.annotations && attached.length > 0) {
    let known: Set<string> | undefined;
    for (const { att, source } of attached) {
      if (!isPdf(att)) continue;
      for (const ann of att.annotations) {
        const result = annotationToCard(ann);
        if (!("card" in result)) continue;
        const card = result.card;
        try {
          if (!isNew) {
            known ??= await existingQuotes(call, citekey);
            if (known.has(normalizeText(card.quote))) continue;
          }
          const created = (await call("cards.create", {
            citekey,
            anchor: { pdf: { page: card.page, quads: card.quads, file: source } },
            quote: card.quote,
            ai: false,
            projects: planned.projects,
            tags: card.tags,
          })) as { card: { frontmatter: { id: string } } };
          out.cards++;
          const patch: Record<string, unknown> = {};
          if (card.note) patch.note = card.note;
          if (card.pageLabel) patch.locator = { label: "page", start: card.pageLabel };
          if (Object.keys(patch).length > 0) {
            await call("cards.update", { id: created.card.frontmatter.id, patch });
          }
        } catch (err) {
          addProblem(out, {
            code: "CARD_FAILED",
            severity: "warning",
            message: `annotation ${ann.ref}: ${errorMessage(err)}`,
            ref: item.ref,
          });
        }
      }
    }
  }

  if (plan.options.notes) {
    for (const note of item.notes) {
      const title = noteTitleFor(note, citekey);
      try {
        if (!isNew && (await existingNoteTitles(call, title)).has(title)) continue;
        await call("notes.create", {
          title,
          body: `Item: [[${citekey}]]\n\n${note.markdown}`,
          type: "literature",
          projects: planned.projects,
        });
        out.notes++;
      } catch (err) {
        addProblem(out, {
          code: "NOTE_FAILED",
          severity: "warning",
          message: `note ${note.ref}: ${errorMessage(err)}`,
          ref: item.ref,
        });
      }
    }
  }
}

function noteTitleFor(note: SourceNote, citekey: string): string {
  return `${note.title ?? "Zotero note"} (${citekey})`;
}

async function existingQuotes(call: Call, citekey: string): Promise<Set<string>> {
  const res = (await call("cards.list", { citekey, limit: 500 })) as { cards: CardRow[] };
  return new Set(res.cards.map((c) => normalizeText(c.body.quote)));
}
