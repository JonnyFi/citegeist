import type { Actor } from "@citegeist/schema";
import { loadItem, saveItem } from "./ingest/items.js";
import type { Library } from "./library.js";

export interface ProjectItemsChange {
  /** Citekeys whose project list changed. */
  changed: string[];
  /** Citekeys that were in the wanted state already. */
  unchanged: string[];
}

/**
 * Adds items to a project or removes them from it, by editing `projects` in each item's
 * frontmatter. The project and every citekey are checked before the first file is written, so a
 * wrong argument changes nothing. Repeating a call changes nothing either.
 */
export function changeProjectItems(
  lib: Library,
  actor: Actor,
  mode: "add" | "remove",
  slug: string,
  citekeys: string[],
): ProjectItemsChange {
  lib.getProject(slug);
  const items = [...new Set(citekeys)].map((c) => loadItem(lib, c));
  const out: ProjectItemsChange = { changed: [], unchanged: [] };
  for (const item of items) {
    const has = item.fm.projects.includes(slug);
    if (has === (mode === "add")) {
      out.unchanged.push(item.fm.citekey);
      continue;
    }
    const projects =
      mode === "add" ? [...item.fm.projects, slug] : item.fm.projects.filter((p) => p !== slug);
    saveItem(lib, actor, item, { projects });
    out.changed.push(item.fm.citekey);
  }
  return out;
}
