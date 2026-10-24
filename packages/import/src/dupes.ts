import type { ItemDraft } from "@citegeist/cite";
import { normalizeArxivId, normalizeDoi, normalizeIsbn } from "@citegeist/metadata";
import type { ExistingItem } from "./types.js";
import { normalizeText, yearOf } from "./util.js";

export type DuplicateReason = "zotero-key" | "doi" | "isbn" | "arxiv" | "title-year-author";

export interface DuplicateMatch {
  citekey: string;
  reason: DuplicateReason;
}

function firstAuthorOf(draft: ItemDraft): string | undefined {
  const first = (draft.author as { family?: string; literal?: string }[] | undefined)?.[0];
  return first?.family ?? first?.literal;
}

/** The fields of a draft that identify it, in the shape of an index row. */
export function existingFromDraft(draft: ItemDraft, citekey: string): ExistingItem {
  const isbn = typeof draft.ISBN === "string" ? draft.ISBN : undefined;
  return {
    citekey,
    title: draft.title,
    year: yearOf(draft.issued),
    firstAuthor: firstAuthorOf(draft),
    doi: typeof draft.DOI === "string" ? draft.DOI : undefined,
    isbn,
    ids: (draft.ids as Record<string, string> | undefined) ?? {},
  };
}

function isbns(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[,;\s]+/)
    .map((t) => normalizeIsbn(t))
    .filter((t): t is string => t !== undefined);
}

/** True when two first authors can be the same person: equal, or the same family name. */
function sameAuthor(a: string | undefined, b: string | undefined): boolean {
  if (a === undefined && b === undefined) return true;
  if (a === undefined || b === undefined) return false;
  const na = normalizeText(a);
  const nb = normalizeText(b);
  return na === nb || na.split(" ").pop() === nb.split(" ").pop();
}

/**
 * Index for duplicate detection. It holds the items of the library and grows with every item the
 * import plans, so that two entries of one file also find each other. The order of the checks is
 * the strength of the evidence: Zotero key, DOI, ISBN, arXiv id, then normalized title with year
 * and first author.
 */
export class DuplicateIndex {
  private readonly zotero = new Map<string, string>();
  private readonly doi = new Map<string, string>();
  private readonly isbn = new Map<string, string>();
  private readonly arxiv = new Map<string, string>();
  private readonly titles = new Map<string, ExistingItem[]>();

  constructor(items: Iterable<ExistingItem> = []) {
    for (const item of items) this.add(item);
  }

  add(item: ExistingItem): void {
    if (item.ids.zotero) this.zotero.set(item.ids.zotero, item.citekey);
    const doi = item.doi ? normalizeDoi(item.doi) : undefined;
    if (doi && !this.doi.has(doi)) this.doi.set(doi, item.citekey);
    for (const i of isbns(item.isbn)) if (!this.isbn.has(i)) this.isbn.set(i, item.citekey);
    const arxiv = item.ids.arxiv ? normalizeArxivId(item.ids.arxiv)?.id : undefined;
    if (arxiv && !this.arxiv.has(arxiv.toLowerCase()))
      this.arxiv.set(arxiv.toLowerCase(), item.citekey);
    const key = titleKey(item.title, item.year);
    if (key) {
      const list = this.titles.get(key) ?? [];
      list.push(item);
      this.titles.set(key, list);
    }
  }

  find(draft: ItemDraft): DuplicateMatch | undefined {
    const ids = (draft.ids as Record<string, string> | undefined) ?? {};
    if (ids.zotero) {
      const hit = this.zotero.get(ids.zotero);
      if (hit) return { citekey: hit, reason: "zotero-key" };
    }
    const doi = typeof draft.DOI === "string" ? normalizeDoi(draft.DOI) : undefined;
    if (doi) {
      const hit = this.doi.get(doi);
      if (hit) return { citekey: hit, reason: "doi" };
    }
    for (const i of isbns(typeof draft.ISBN === "string" ? draft.ISBN : undefined)) {
      const hit = this.isbn.get(i);
      if (hit) return { citekey: hit, reason: "isbn" };
    }
    const arxiv = ids.arxiv ? normalizeArxivId(ids.arxiv)?.id : undefined;
    if (arxiv) {
      const hit = this.arxiv.get(arxiv.toLowerCase());
      if (hit) return { citekey: hit, reason: "arxiv" };
    }
    const year = yearOf(draft.issued);
    const author = firstAuthorOf(draft);
    const key = titleKey(draft.title, year);
    // A title alone is too weak: "Introduction" or "Untitled" would swallow unrelated entries.
    if (key && (year !== undefined || author !== undefined)) {
      for (const other of this.titles.get(key) ?? []) {
        if (sameAuthor(author, other.firstAuthor)) {
          return { citekey: other.citekey, reason: "title-year-author" };
        }
      }
    }
    return undefined;
  }
}

function titleKey(title: string, year: string | undefined): string | undefined {
  const t = normalizeText(title);
  if (t.length < 4 || t === "untitled") return undefined;
  return `${t}|${year ?? ""}`;
}
