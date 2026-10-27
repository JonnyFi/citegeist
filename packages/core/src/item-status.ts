import { type Actor, type ItemStatus, localDateOf, statusPatch } from "@citegeist/schema";
import { loadItem, saveItem } from "./ingest/items.js";
import type { Library } from "./library.js";

export interface ItemStatusChange {
  /** Citekeys whose status changed. */
  changed: string[];
  /** Citekeys that had the status already, or whose current status is not in `from`. */
  unchanged: string[];
}

/**
 * Sets the reading status of items and keeps `read_at` in step (see `statusPatch`). Every citekey
 * is checked before the first file is written, so a wrong argument changes nothing. Repeating a
 * call changes nothing either. With `from`, an item whose current status is not in the list is
 * left alone.
 */
export function setItemStatus(
  lib: Library,
  actor: Actor,
  citekeys: string[],
  status: ItemStatus,
  from?: readonly ItemStatus[],
): ItemStatusChange {
  const items = [...new Set(citekeys)].map((c) => loadItem(lib, c));
  const today = localDateOf(new Date(lib.stamp(actor).at));
  const out: ItemStatusChange = { changed: [], unchanged: [] };
  for (const item of items) {
    const patch = from && !from.includes(item.fm.status) ? {} : statusPatch(item.fm, status, today);
    if (Object.keys(patch).length === 0) {
      out.unchanged.push(item.fm.citekey);
      continue;
    }
    saveItem(lib, actor, item, patch);
    out.changed.push(item.fm.citekey);
  }
  return out;
}
