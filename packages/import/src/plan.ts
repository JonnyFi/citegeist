import { extname } from "node:path";
import { type CitekeySource, resolveImportedCitekey } from "@citegeist/cite";
import type { ImportReport } from "@citegeist/ops";
import { DuplicateIndex, type DuplicateReason, existingFromDraft } from "./dupes.js";
import type {
  ImportHost,
  ImportOptions,
  ImportProblem,
  SourceAttachment,
  SourceBundle,
  SourceItem,
  SourceNote,
} from "./types.js";
import { slug, usableCitekey } from "./util.js";
import { annotationToCard } from "./zotero/annotations.js";

export type Action = "create" | "merge" | "skip";

export interface PlannedItem {
  item: SourceItem;
  action: Action;
  /** The citekey the item gets (create) or already has (merge, skip). */
  citekey: string;
  duplicateOf?: string;
  reason?: DuplicateReason;
  /** Project slugs and tags the item receives. */
  projects: string[];
  tags: string[];
}

export interface PlannedProject {
  slug: string;
  title: string;
}

export interface Plan {
  bundle: SourceBundle;
  options: ImportOptions;
  /** Provenance tag with the date, such as `zotero@2026-10-24`. */
  provenance: string;
  now: Date;
  items: PlannedItem[];
  standaloneNotes: SourceNote[];
  projectsToCreate: PlannedProject[];
  problems: ImportProblem[];
  counts: ImportReport["counts"];
}

const MAX_ITEMS = 500;
const MAX_PROBLEMS = 200;

export function isPdf(att: SourceAttachment): boolean {
  return (
    (att.contentType ?? "").toLowerCase() === "application/pdf" ||
    extname(att.filename).toLowerCase() === ".pdf"
  );
}

function collectionTitle(path: string): string {
  return path.split("/").join(" / ");
}

export interface PlanInput {
  bundle: SourceBundle;
  options: ImportOptions;
  host: ImportHost;
  existingProjects: ReadonlySet<string>;
  now: Date;
}

/**
 * Decides, without writing anything, what a run would do: which entries are new, which are
 * duplicates, the citekeys, the projects and a count of everything that follows from them.
 */
export function buildPlan(input: PlanInput): Plan {
  const { bundle, options, host, now } = input;
  const problems: ImportProblem[] = [...bundle.problems];
  const provenance = `${bundle.tag}@${now.toISOString().slice(0, 10)}`;

  // Projects: collections as projects, plus the project of the options.
  const slugs = new Map<string, string>();
  const taken = new Set(input.existingProjects);
  const projectsToCreate: PlannedProject[] = [];
  const projectFor = (path: string): string => {
    const known = slugs.get(path);
    if (known) return known;
    const base = slug(path) || "collection";
    let candidate = base;
    const reserved = new Set(slugs.values());
    for (let n = 2; reserved.has(candidate); n++) candidate = `${base.slice(0, 60)}-${n}`;
    slugs.set(path, candidate);
    if (!taken.has(candidate)) {
      taken.add(candidate);
      projectsToCreate.push({ slug: candidate, title: collectionTitle(path) });
    }
    return candidate;
  };
  if (options.project && !taken.has(options.project)) {
    taken.add(options.project);
    projectsToCreate.push({ slug: options.project, title: options.project });
  }

  const index = new DuplicateIndex(host.existingItems());
  const keys = new Set(host.existingCitekeys());
  const formula = host.citekeyFormula();
  const planned: PlannedItem[] = [];
  const allTags = new Set<string>();

  for (const item of bundle.items) {
    const dupe = index.find(item.draft);
    const projects = new Set<string>();
    const tags = new Set<string>(options.tags);
    if (!dupe || options.onDuplicate !== "skip") {
      if (options.project) projects.add(options.project);
      for (const path of item.collections) {
        if (options.collections === "projects") projects.add(projectFor(path));
        else if (options.collections === "tags") tags.add(path);
      }
    }
    if (dupe) {
      planned.push({
        item,
        action: options.onDuplicate,
        citekey: dupe.citekey,
        duplicateOf: dupe.citekey,
        reason: dupe.reason,
        projects: [...projects],
        tags: [...tags],
      });
      continue;
    }
    const source: CitekeySource & { citekey?: string } = {
      title: item.draft.title,
      ...(item.draft.author ? { author: item.draft.author } : {}),
      ...(item.draft.editor ? { editor: item.draft.editor } : {}),
      ...(item.draft.issued !== undefined ? { issued: item.draft.issued } : {}),
    };
    const wanted = usableCitekey(item.draft.citekey);
    const citekey = resolveImportedCitekey(
      wanted ? { ...source, citekey: wanted } : source,
      keys,
      formula,
    );
    keys.add(citekey);
    index.add(existingFromDraft(item.draft, citekey));
    planned.push({
      item,
      action: "create",
      citekey,
      projects: [...projects],
      tags: [...tags],
    });
  }
  for (const p of planned)
    for (const t of [...(p.item.draft.tags ?? []), ...p.tags]) allTags.add(t);

  const counts: ImportReport["counts"] = {
    items: planned.length,
    create: planned.filter((p) => p.action === "create").length,
    merge: planned.filter((p) => p.action === "merge").length,
    skip: planned.filter((p) => p.action === "skip").length,
    attachments: 0,
    attachmentsMissing: 0,
    notes: 0,
    annotations: 0,
    annotationsSkipped: 0,
    collections: bundle.collections.length,
    tags: allTags.size,
    projects: projectsToCreate.length,
  };

  const skippedBy = new Map<string, { count: number; message: string }>();
  const missingExamples: string[] = [];
  for (const p of planned) {
    if (p.action === "skip") continue;
    if (options.notes) counts.notes += p.item.notes.length;
    if (!options.attachments) continue;
    for (const att of p.item.attachments) {
      if (att.missing) {
        counts.attachmentsMissing++;
        if (missingExamples.length < 20) {
          problems.push({
            code: "ATTACHMENT_MISSING",
            severity: att.path ? "info" : "warning",
            message: `${att.filename}: ${att.missing}`,
            ref: p.item.ref,
          });
        }
        missingExamples.push(att.ref);
        continue;
      }
      counts.attachments++;
      if (!options.annotations) continue;
      for (const ann of att.annotations) {
        const result = isPdf(att)
          ? annotationToCard(ann)
          : {
              skip: {
                code: "ANNOTATION_NOT_PDF",
                message: "annotations of EPUB and web snapshots are not imported",
              },
            };
        if ("card" in result) counts.annotations++;
        else {
          counts.annotationsSkipped++;
          const entry = skippedBy.get(result.skip.code) ?? {
            count: 0,
            message: result.skip.message,
          };
          entry.count++;
          skippedBy.set(result.skip.code, entry);
        }
      }
    }
  }
  if (missingExamples.length > 20) {
    problems.push({
      code: "ATTACHMENT_MISSING",
      severity: "info",
      message: `${missingExamples.length - 20} more attachments without a usable file`,
    });
  }
  for (const [code, { count, message }] of skippedBy) {
    problems.push({ code, severity: "info", message: `${count} annotations skipped: ${message}` });
  }
  if (options.notes) counts.notes += bundle.standaloneNotes.length;
  if (options.annotations && !options.attachments) {
    problems.push({
      code: "ANNOTATIONS_NEED_ATTACHMENTS",
      severity: "warning",
      message: "annotations were not imported because attachments are switched off",
    });
  }
  const dupes = counts.merge + counts.skip;
  if (dupes > 0) {
    problems.push({
      code: "DUPLICATES_FOUND",
      severity: "info",
      message: `${dupes} of ${counts.items} entries are already in the library or appear twice in the source (${options.onDuplicate === "merge" ? "merged" : "skipped"})`,
    });
  }

  return {
    bundle,
    options,
    provenance,
    now,
    items: planned,
    standaloneNotes: options.notes ? bundle.standaloneNotes : [],
    projectsToCreate,
    problems,
    counts,
  };
}

/** The dry-run report of a plan. Long lists are cut, the counts stay complete. */
export function toReport(plan: Plan): ImportReport {
  const items = plan.items.slice(0, MAX_ITEMS).map((p) => ({
    ref: p.item.ref,
    title: p.item.draft.title,
    citekey: p.citekey,
    action: p.action,
    ...(p.duplicateOf ? { duplicateOf: p.duplicateOf } : {}),
    ...(p.reason ? { reason: p.reason } : {}),
  }));
  return {
    source: plan.bundle.label,
    provenance: plan.provenance,
    counts: plan.counts,
    items,
    truncated: plan.items.length > MAX_ITEMS || plan.problems.length > MAX_PROBLEMS,
    problems: plan.problems.slice(0, MAX_PROBLEMS),
    problemCount: plan.problems.length,
  };
}
