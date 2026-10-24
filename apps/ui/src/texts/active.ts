import { textsGet, textsUpdate } from "@citegeist/ops";
import { useSyncExternalStore } from "react";
import type { Core } from "../lib/core";

/**
 * The text Jonny works on. The Texte tab publishes it while a text is open; the card actions
 * insert into it and the chat hands it to the agent, as with the open plan. It lives outside React
 * state so the panels need no shared parent.
 *
 * `open` is set while the editor is on screen. `last` stays after the tab closes, so a card in the
 * reader can still put a quotation into the chapter that was open a moment ago.
 */
export interface ActiveText {
  project: string;
  text: string;
  title: string;
}

interface Store {
  open: ActiveText | null;
  last: ActiveText | null;
}

let state: Store = { open: null, last: null };
let inserter: ((snippet: string) => void) | null = null;
const listeners = new Set<() => void>();

const same = (a: ActiveText | null, b: ActiveText | null) =>
  JSON.stringify(a) === JSON.stringify(b);

function set(next: Store): void {
  if (same(next.open, state.open) && same(next.last, state.last)) return;
  state = next;
  for (const l of listeners) l();
}

/** The Texte tab calls this with the open text, and with null when it closes. */
export function publishOpenText(next: ActiveText | null): void {
  set({ open: next, last: next ?? state.last });
}

/** The editor registers how to put text at its cursor, and removes it when it goes away. */
export function registerInserter(fn: ((snippet: string) => void) | null): void {
  inserter = fn;
}

export function currentOpenText(): ActiveText | null {
  return state.open;
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** The text that is open now, for the chat chip. */
export function useOpenText(): ActiveText | null {
  return useSyncExternalStore(
    subscribe,
    () => state.open,
    () => null,
  );
}

/** The text a card can insert into: the open one, else the last one that was open. */
export function useInsertTarget(): ActiveText | null {
  return useSyncExternalStore(
    subscribe,
    () => state.last,
    () => null,
  );
}

/**
 * Puts `snippet` into the text: at the cursor when its editor is on screen, otherwise at the end
 * of the file through the core.
 */
export async function insertIntoText(core: Core, snippet: string): Promise<ActiveText> {
  const target = state.last;
  if (!target) throw new Error("no text is open");
  if (state.open && inserter) {
    inserter(snippet);
    return target;
  }
  const current = await core.call(textsGet, { project: target.project, text: target.text });
  const body = current.body.trimEnd();
  await core.call(textsUpdate, {
    project: target.project,
    text: target.text,
    body: body ? `${body}\n\n${snippet}\n` : `${snippet}\n`,
    baseHash: current.hash,
  });
  return target;
}

/** Test helper: forget everything. */
export function resetActiveText(): void {
  inserter = null;
  set({ open: null, last: null });
}
