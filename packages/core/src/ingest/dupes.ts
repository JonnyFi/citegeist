import { normalizeIsbn } from "@citegeist/metadata";
import type { Library } from "../library.js";

export interface DuplicateQuery {
  doi?: string | undefined;
  isbn?: string | undefined;
  arxiv?: string | undefined;
  url?: string | undefined;
  /** First 12 hex chars of the SHA-256 of a local file. */
  hash?: string | undefined;
  title?: string | undefined;
  year?: string | number | undefined;
  /** Family name (or literal name) of the first author. */
  firstAuthor?: string | undefined;
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
 * Finds an item that is the same work: same DOI, ISBN, arXiv id or file hash, or the same
 * normalized title, year and first author. Returns its citekey.
 */
export function findDuplicate(lib: Library, q: DuplicateQuery): string | undefined {
  const idx = lib.index;
  if (q.doi) {
    const row = idx.get<{ citekey: string }>(
      "SELECT citekey FROM items WHERE lower(doi) = ?",
      q.doi.toLowerCase(),
    );
    if (row) return row.citekey;
  }
  if (q.arxiv) {
    const row = idx.get<{ citekey: string }>(
      "SELECT citekey FROM items WHERE lower(json_extract(frontmatter_json, '$.ids.arxiv')) = ?",
      q.arxiv.toLowerCase(),
    );
    if (row) return row.citekey;
  }
  if (q.url) {
    const row = idx.get<{ citekey: string }>("SELECT citekey FROM items WHERE url = ?", q.url);
    if (row) return row.citekey;
  }
  if (q.hash) {
    const row = idx.get<{ citekey: string }>(
      "SELECT citekey FROM items WHERE instr(frontmatter_json, ?) > 0",
      `"hash":"${q.hash}"`,
    );
    if (row) return row.citekey;
  }
  if (q.isbn) {
    const wanted = normalizeIsbn(q.isbn);
    if (wanted) {
      const rows = idx.all<{ citekey: string; isbn: string }>(
        "SELECT citekey, isbn FROM items WHERE isbn IS NOT NULL",
      );
      for (const r of rows) {
        const tokens = r.isbn.split(/[,;\s]+/).filter(Boolean);
        if (tokens.some((t) => normalizeIsbn(t) === wanted)) return r.citekey;
      }
    }
  }
  if (q.title) {
    const title = normalizeText(q.title);
    const year = yearOf(q.year);
    const author = q.firstAuthor ? normalizeText(q.firstAuthor) : undefined;
    const rows = idx.all<{ citekey: string; title: string; year: string | null }>(
      year
        ? "SELECT citekey, title, year FROM items WHERE year = ?"
        : "SELECT citekey, title, year FROM items WHERE year IS NULL",
      ...(year ? [year] : []),
    );
    for (const r of rows) {
      if (normalizeText(r.title) !== title) continue;
      const first = idx.get<{ family: string | null; literal: string | null }>(
        "SELECT family, literal FROM creators WHERE citekey = ? AND role = 'author' ORDER BY pos LIMIT 1",
        r.citekey,
      );
      const other = first ? normalizeText(first.family ?? first.literal ?? "") : undefined;
      if (author === undefined && other === undefined) return r.citekey;
      if (author !== undefined && other !== undefined) {
        const a = author.split(" ").pop();
        const b = other.split(" ").pop();
        if (author === other || a === b) return r.citekey;
      }
    }
  }
  return undefined;
}
