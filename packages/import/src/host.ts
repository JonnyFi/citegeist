import { readdirSync } from "node:fs";
import { CitegeistError, type ItemFrontmatter } from "@citegeist/schema";
import type { ExistingItem, ImportHost } from "./types.js";

/**
 * The part of the core's Library that the importer reads and writes. `Library` from
 * @citegeist/core fits as it is, so this package does not depend on the core.
 */
export interface LibraryLike {
  index: { all<T>(sql: string, ...params: unknown[]): T[] };
  paths: { itemsDir: string };
  manifest: { defaults: { citekey: string } };
  getItem(citekey: string): { frontmatter: ItemFrontmatter; note: string };
  writeItem(
    fm: ItemFrontmatter,
    body?: string,
  ): { status: string; issues?: { message: string }[] | undefined };
}

interface ItemRow {
  citekey: string;
  title: string;
  year: string | null;
  doi: string | null;
  isbn: string | null;
  frontmatter_json: string;
}

interface CreatorRow {
  citekey: string;
  family: string | null;
  literal: string | null;
}

/** Builds the importer's view of a library. */
export function createLibraryHost(lib: LibraryLike): ImportHost {
  return {
    existingItems() {
      const rows = lib.index.all<ItemRow>(
        "SELECT citekey, title, year, doi, isbn, frontmatter_json FROM items",
      );
      const first = new Map<string, string>();
      for (const c of lib.index.all<CreatorRow>(
        "SELECT citekey, family, literal FROM creators WHERE role = 'author' ORDER BY citekey, pos",
      )) {
        if (!first.has(c.citekey)) first.set(c.citekey, c.family ?? c.literal ?? "");
      }
      return rows.map((r): ExistingItem => {
        let ids: Record<string, string> = {};
        try {
          ids = (JSON.parse(r.frontmatter_json) as { ids?: Record<string, string> }).ids ?? {};
        } catch {
          // The index holds valid JSON; an unreadable row is treated as having no ids.
        }
        return {
          citekey: r.citekey,
          title: r.title,
          year: r.year ?? undefined,
          firstAuthor: first.get(r.citekey) || undefined,
          doi: r.doi ?? undefined,
          isbn: r.isbn ?? undefined,
          ids,
        };
      });
    },
    existingCitekeys() {
      const keys = new Set(
        lib.index.all<{ citekey: string }>("SELECT citekey FROM items").map((r) => r.citekey),
      );
      try {
        for (const entry of readdirSync(lib.paths.itemsDir)) keys.add(entry);
      } catch {
        // No items folder yet.
      }
      return keys;
    },
    citekeyFormula() {
      return lib.manifest.defaults.citekey;
    },
    readItem(citekey) {
      const got = lib.getItem(citekey);
      return { frontmatter: got.frontmatter, body: got.note };
    },
    writeItem(frontmatter, body = "") {
      const result = lib.writeItem(frontmatter, body);
      if (result.status !== "indexed") {
        throw new CitegeistError({
          code: "ITEM_NOT_CREATED",
          message: `the item ${frontmatter.citekey} was not accepted by the index: ${(result.issues ?? []).map((i) => i.message).join("; ") || result.status}`,
          fix: "Check the problem list in library.status and retry.",
          recovery: "fix-and-retry",
          context: { citekey: frontmatter.citekey },
        });
      }
    },
  };
}
