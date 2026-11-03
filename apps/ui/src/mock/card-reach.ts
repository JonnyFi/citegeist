import { scanWikiLinks } from "@citegeist/editor";
import type { Link } from "@citegeist/schema";
import { typedTarget } from "../connections/mock";
import { storeFor } from "../notes/mock";
import type { MockData } from "./fixtures";

/** A typed link that a delete takes out of a note, with the place it had. */
export interface MockRemovedLink {
  note: string;
  index: number;
  link: Link;
}

export interface MockReach {
  notes: number;
  cards: number;
  links: MockRemovedLink[];
  mentions: number;
}

/**
 * Who refers to a card in the mock library, counted the way the core counts it: notes with a typed
 * link to the card or a wiki link to it, other cards that mention it, the typed links that point at
 * it or start at it (these go with the card) and the sources that only mention it in their text.
 */
export function mockCardReach(data: MockData, id: string): MockReach {
  const notes = new Set<string>();
  const cards = new Set<string>();
  const mentions = new Set<string>();
  const links: MockRemovedLink[] = [];
  for (const note of storeFor(data).values()) {
    const noteId = note.frontmatter.id;
    note.frontmatter.links.forEach((link, index) => {
      if (link.status === "rejected") return;
      if (link.from === id || typedTarget(link) === id) {
        links.push({ note: noteId, index, link });
        if (link.from === undefined) notes.add(noteId);
        else if (link.from !== id) cards.add(link.from);
      } else if (link.evidence && typedTarget({ ...link, to: link.evidence }) === id) {
        notes.add(noteId);
        mentions.add(noteId);
      }
    });
    if (scanWikiLinks(note.body).some((m) => m.target === id)) {
      notes.add(noteId);
      mentions.add(noteId);
    }
  }
  for (const card of data.cards) {
    if (card.frontmatter.id === id) continue;
    const text = [card.body.paraphrase, card.body.note].filter(Boolean).join("\n");
    if (scanWikiLinks(text).some((m) => m.target === id)) {
      cards.add(card.frontmatter.id);
      mentions.add(card.frontmatter.id);
    }
  }
  return { notes: notes.size, cards: cards.size, links, mentions: mentions.size };
}

/** Takes the removed links out of their notes. */
export function mockRemoveLinks(data: MockData, removed: MockRemovedLink[]): void {
  const store = storeFor(data);
  for (const noteId of new Set(removed.map((r) => r.note))) {
    const note = store.get(noteId);
    if (!note) continue;
    const gone = new Set(removed.filter((r) => r.note === noteId).map((r) => r.index));
    note.frontmatter = {
      ...note.frontmatter,
      links: note.frontmatter.links.filter((_, i) => !gone.has(i)),
    };
  }
}

/** Puts removed links back at their old places in their notes. */
export function mockReaddLinks(data: MockData, removed: MockRemovedLink[]): void {
  const store = storeFor(data);
  for (const noteId of new Set(removed.map((r) => r.note))) {
    const note = store.get(noteId);
    if (!note) continue;
    const links = note.frontmatter.links.slice();
    for (const r of removed.filter((x) => x.note === noteId).sort((a, b) => a.index - b.index)) {
      links.splice(Math.min(r.index, links.length), 0, r.link);
    }
    note.frontmatter = { ...note.frontmatter, links };
  }
}
