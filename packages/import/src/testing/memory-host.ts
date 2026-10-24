import type { ItemFrontmatter } from "@citegeist/schema";
import type { ExistingItem, ImportHost } from "../types.js";
import { yearOf } from "../util.js";

/** An in-memory library for tests that do not need the core. */
export class MemoryHost implements ImportHost {
  readonly items = new Map<string, { frontmatter: ItemFrontmatter; body: string }>();
  readonly writes: string[] = [];
  formula: string | undefined;

  constructor(initial: ExistingItem[] = []) {
    for (const e of initial) this.seed(e);
  }

  /** Adds an item that is already in the library. */
  seed(e: Partial<ExistingItem> & { citekey: string; title: string }): void {
    const fm = {
      id: "01JB8Z3QK7ABCDEFGH0000".slice(0, 22),
      citekey: e.citekey,
      type: "article-journal",
      title: e.title,
      ...(e.year ? { issued: Number(e.year) } : {}),
      ...(e.firstAuthor ? { author: [{ family: e.firstAuthor }] } : {}),
      ...(e.doi ? { DOI: e.doi } : {}),
      ...(e.isbn ? { ISBN: e.isbn } : {}),
      ids: e.ids ?? {},
      tags: [],
      projects: [],
      sources: [],
      provenance: {},
      status: "unread",
      created: { at: "2026-01-01T00:00:00.000Z", by: "human" },
    } as unknown as ItemFrontmatter;
    this.items.set(e.citekey, { frontmatter: fm, body: "" });
  }

  existingItems(): ExistingItem[] {
    return [...this.items.values()].map(({ frontmatter: fm }) => {
      const first = (fm.author as { family?: string; literal?: string }[] | undefined)?.[0];
      return {
        citekey: fm.citekey,
        title: fm.title,
        year: yearOf(fm.issued),
        firstAuthor: first?.family ?? first?.literal,
        doi: fm.DOI,
        isbn: fm.ISBN,
        ids: fm.ids,
      };
    });
  }

  existingCitekeys(): Set<string> {
    return new Set(this.items.keys());
  }

  citekeyFormula(): string | undefined {
    return this.formula;
  }

  readItem(citekey: string) {
    const got = this.items.get(citekey);
    if (!got) throw new Error(`no item ${citekey}`);
    return got;
  }

  writeItem(frontmatter: ItemFrontmatter, body = ""): void {
    this.writes.push(frontmatter.citekey);
    this.items.set(frontmatter.citekey, { frontmatter, body });
  }
}
