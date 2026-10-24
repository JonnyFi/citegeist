import { finalizeDraft, type ItemDraft } from "@citegeist/cite";
import { ItemFrontmatter } from "@citegeist/schema";
import { ulid } from "./util.js";

/** Keys that never travel from a draft into an existing item. */
const NOT_MERGED = new Set(["citekey", "ids", "tags", "projects", "provenance", "type", "title"]);

export interface BuildInput {
  draft: ItemDraft;
  citekey: string;
  /** Provenance tag, such as "zotero". */
  tag: string;
  now: Date;
  /** When the entry was added in the source system. It becomes `created`. */
  dateAdded?: string | undefined;
  tags: string[];
  projects: string[];
}

/** Builds the frontmatter of a new item. Every field carries the provenance `<tag>@<date>`. */
export function buildFrontmatter(input: BuildInput): ItemFrontmatter {
  const at = input.now.toISOString();
  const draft: ItemDraft = { ...input.draft, tags: input.tags };
  const fm = finalizeDraft(draft, input.citekey, {
    id: ulid(input.now.getTime()),
    at,
    by: "system",
    provenanceTag: input.tag,
  });
  const added =
    input.dateAdded && !Number.isNaN(Date.parse(input.dateAdded)) ? input.dateAdded : at;
  return ItemFrontmatter.parse({
    ...fm,
    projects: input.projects,
    created: { at: new Date(added).toISOString(), by: "system" },
  });
}

export interface MergeResult {
  frontmatter: ItemFrontmatter;
  /** Fields that were empty and now hold a value from the import. */
  filled: string[];
  changed: boolean;
}

const isEmpty = (v: unknown): boolean =>
  v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);

/**
 * Merges an imported entry into an item that is in the library. What the item has stays: only
 * empty fields are filled, and tags, projects and identifiers are added. The fields that were
 * filled get the provenance `<tag>@<date>`.
 */
export function mergeFrontmatter(
  existing: ItemFrontmatter,
  input: Pick<BuildInput, "draft" | "tag" | "now" | "tags" | "projects">,
): MergeResult {
  const day = input.now.toISOString().slice(0, 10);
  const next: Record<string, unknown> = { ...existing };
  const provenance: Record<string, string> = { ...existing.provenance };
  const filled: string[] = [];
  for (const [key, value] of Object.entries(input.draft)) {
    if (NOT_MERGED.has(key) || isEmpty(value) || !isEmpty(next[key])) continue;
    next[key] = value;
    provenance[key] = `${input.tag}@${day}`;
    filled.push(key);
  }
  const ids = {
    ...((input.draft.ids as Record<string, string> | undefined) ?? {}),
    ...existing.ids,
  };
  const tags = [...new Set([...existing.tags, ...input.tags])];
  const projects = [...new Set([...existing.projects, ...input.projects])];
  const changed =
    filled.length > 0 ||
    tags.length !== existing.tags.length ||
    projects.length !== existing.projects.length ||
    Object.keys(ids).length !== Object.keys(existing.ids).length;
  if (changed) next.modified = { at: input.now.toISOString(), by: "system" };
  const frontmatter = ItemFrontmatter.parse({ ...next, ids, tags, projects, provenance });
  return { frontmatter, filled, changed };
}
