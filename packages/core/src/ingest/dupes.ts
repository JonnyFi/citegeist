import { normalizeIsbn } from "@citegeist/metadata";
import type { Library } from "../library.js";

export interface DuplicateQuery {
  doi?: string | undefined;
  isbn?: string | undefined;
  arxiv?: string | undefined;
  pmid?: string | undefined;
  url?: string | undefined;
  /** First 12 hex chars of the SHA-256 of a local file. */
  hash?: string | undefined;
  title?: string | undefined;
  year?: string | number | undefined;
  /** Family name (or literal name) of the first author. */
  firstAuthor?: string | undefined;
  /** An item that never counts as the duplicate: the one the query is made for. */
  except?: string | undefined;
}

/** Lower-case, accent-free text with single spaces, for comparing titles and names. */
export function normalizeText(s: string): string {
  return s
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function yearOf(issued: string | number | undefined): string | undefined {
  if (issued === undefined) return undefined;
  return /^-?(\d{1,4})/.exec(String(issued))?.[1];
}

/**
 * Finds an item that is the same work: same DOI, ISBN, arXiv id, URL or file hash, or the same
 * normalized title, year and first author (all three must be known). Returns its citekey.
 */
export function findDuplicate(lib: Library, q: DuplicateQuery): string | undefined {
  const idx = lib.index;
  const except = q.except ?? "";
  if (q.doi) {
    const row = idx.get<{ citekey: string }>(
      "SELECT citekey FROM items WHERE lower(doi) = ? AND citekey <> ?",
      q.doi.toLowerCase(),
      except,
    );
    if (row) return row.citekey;
  }
  if (q.arxiv) {
    const row = idx.get<{ citekey: string }>(
      "SELECT citekey FROM items WHERE lower(json_extract(frontmatter_json, '$.ids.arxiv')) = ? AND citekey <> ?",
      q.arxiv.toLowerCase(),
      except,
    );
    if (row) return row.citekey;
  }
  if (q.pmid) {
    const row = idx.get<{ citekey: string }>(
      "SELECT citekey FROM items WHERE json_extract(frontmatter_json, '$.ids.pmid') = ? AND citekey <> ?",
      q.pmid,
      except,
    );
    if (row) return row.citekey;
  }
  if (q.url) {
    const row = idx.get<{ citekey: string }>(
      "SELECT citekey FROM items WHERE url = ? AND citekey <> ?",
      q.url,
      except,
    );
    if (row) return row.citekey;
  }
  if (q.hash) {
    const row = idx.get<{ citekey: string }>(
      "SELECT citekey FROM items WHERE instr(frontmatter_json, ?) > 0 AND citekey <> ?",
      `"hash":"${q.hash}"`,
      except,
    );
    if (row) return row.citekey;
  }
  if (q.isbn) {
    const wanted = normalizeIsbn(q.isbn);
    if (wanted) {
      const rows = idx.all<{ citekey: string; isbn: string }>(
        "SELECT citekey, isbn FROM items WHERE isbn IS NOT NULL AND citekey <> ?",
        except,
      );
      for (const r of rows) {
        const tokens = r.isbn.split(/[,;\s]+/).filter(Boolean);
        if (tokens.some((t) => normalizeIsbn(t) === wanted)) return r.citekey;
      }
    }
  }
  // Without a strong identifier, only the full set counts: the same title, the same year and the
  // same first author. A title alone, or a title with a missing year or author, is not enough.
  if (q.title && q.year !== undefined && q.firstAuthor) {
    const title = normalizeText(q.title);
    const year = yearOf(q.year);
    const author = normalizeText(q.firstAuthor);
    if (!title || !year || !author) return undefined;
    const rows = idx.all<{ citekey: string; title: string }>(
      "SELECT citekey, title FROM items WHERE year = ? AND citekey <> ?",
      year,
      except,
    );
    for (const r of rows) {
      if (normalizeText(r.title) !== title) continue;
      const first = idx.get<{ family: string | null; literal: string | null }>(
        "SELECT family, literal FROM creators WHERE citekey = ? AND role = 'author' ORDER BY pos LIMIT 1",
        r.citekey,
      );
      const other = first ? normalizeText(first.family ?? first.literal ?? "") : "";
      if (!other) continue;
      if (author === other || author.split(" ").pop() === other.split(" ").pop()) return r.citekey;
    }
  }
  return undefined;
}
