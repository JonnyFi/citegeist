import type { ReadingEntry } from "@citegeist/schema";

/**
 * The reading order of a project (docs/decisions/0035-ordered-reading-list.md). The core and the
 * mock core of the UI use the same functions, so the rules live once.
 */

/** What the order needs to know about an item of the project. */
export interface ReadingMember {
  citekey: string;
  /** When the item was added to the library (ISO timestamp). */
  added?: string | undefined;
}

/**
 * The members in reading order: first the ones the stored order names, in that order, then the
 * rest by date added (oldest first) and citekey. Stored entries for items that are not members
 * are ignored, and so is a second entry for the same item.
 */
export function orderReading<M extends ReadingMember>(
  stored: readonly ReadingEntry[],
  members: readonly M[],
): { member: M; note?: string }[] {
  const byKey = new Map(members.map((m) => [m.citekey, m]));
  const out: { member: M; note?: string }[] = [];
  const seen = new Set<string>();
  for (const entry of stored) {
    const member = byKey.get(entry.item);
    if (!member || seen.has(entry.item)) continue;
    seen.add(entry.item);
    out.push({ member, ...(entry.note ? { note: entry.note } : {}) });
  }
  const rest = members
    .filter((m) => !seen.has(m.citekey))
    .sort((a, b) => {
      const byDate = (a.added ?? "").localeCompare(b.added ?? "");
      return byDate !== 0 ? byDate : a.citekey < b.citekey ? -1 : a.citekey > b.citekey ? 1 : 0;
    });
  for (const member of rest) out.push({ member });
  return out;
}

/** Moves `citekey` to `position` (0 is first, a position past the end means last). */
export function moveEntry(
  order: readonly ReadingEntry[],
  citekey: string,
  position: number,
): ReadingEntry[] {
  const entry = order.find((e) => e.item === citekey);
  if (!entry) return [...order];
  const rest = order.filter((e) => e.item !== citekey);
  rest.splice(Math.min(position, rest.length), 0, entry);
  return rest;
}

/** The first item that is not read yet, in the given order. */
export function nextToRead<T extends { status: string }>(entries: readonly T[]): T | undefined {
  return entries.find((e) => e.status !== "read");
}

/** Notes are one short line. */
export function cleanNote(note: string): string {
  return note.replace(/\s+/g, " ").trim();
}
