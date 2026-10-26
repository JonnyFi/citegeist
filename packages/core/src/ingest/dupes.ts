import {
  detectIdentifier,
  normalizeIsbn,
  stripSiteName,
  titleSimilarity,
} from "@citegeist/metadata";
import type { Library } from "../library.js";

export interface DuplicateQuery {
  doi?: string | undefined;
  isbn?: string | undefined;
  arxiv?: string | undefined;
  pmid?: string | undefined;
  url?: string | undefined;
  /** More addresses of the same work: the landing page of its DOI, the page it was found on. */
  urls?: string[] | undefined;
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

const TRACKING = /^(utm_|fbclid$|gclid$|mc_|ref$|source$|_ga$)/i;

/**
 * An address as a key for comparing: no scheme, no `www.`, no fragment, no tracking parameters,
 * no trailing slash, lower-case host. Two spellings of one page give the same key.
 */
export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    const params = [...u.searchParams.entries()]
      .filter(([k]) => !TRACKING.test(k))
      .sort(([a], [b]) => a.localeCompare(b));
    const query = params.map(([k, v]) => `${k}=${v}`).join("&");
    const path = u.pathname.replace(/\/+$/, "");
    return `${u.hostname.toLowerCase().replace(/^www\./, "")}${path}${query ? `?${query}` : ""}`;
  } catch {
    return url.trim().toLowerCase();
  }
}

/** Every address an item is known by: its URL field and the origin of each of its sources. */
function itemAddresses(lib: Library, except: string): Array<{ citekey: string; url: string }> {
  const idx = lib.index;
  const own = idx.all<{ citekey: string; url: string }>(
    "SELECT citekey, url FROM items WHERE url IS NOT NULL AND citekey <> ?",
    except,
  );
  const sources = idx.all<{ citekey: string; url: string }>(
    "SELECT i.citekey AS citekey, json_extract(s.value, '$.url') AS url FROM items i, json_each(i.frontmatter_json, '$.sources') s WHERE json_extract(s.value, '$.url') IS NOT NULL AND i.citekey <> ?",
    except,
  );
  return [...own, ...sources];
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
  if (q.url || q.urls?.length || q.doi || q.arxiv) {
    const wanted = new Set(
      [q.url, ...(q.urls ?? [])].filter(Boolean).map((u) => normalizeUrl(u as string)),
    );
    for (const row of itemAddresses(lib, except)) {
      if (wanted.has(normalizeUrl(row.url))) return row.citekey;
      // The address of the item names the work: a doi.org link, an SSRN or arXiv page.
      const named = q.doi || q.arxiv ? detectIdentifier(row.url) : undefined;
      if (named?.via === "url") {
        if (q.doi && named.kind === "doi" && named.value === q.doi.toLowerCase())
          return row.citekey;
        if (
          q.arxiv &&
          named.kind === "arxiv" &&
          named.value.toLowerCase() === q.arxiv.toLowerCase()
        )
          return row.citekey;
      }
    }
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

export interface EnrichQuery {
  title: string;
  year?: string | number | undefined;
  firstAuthor?: string | undefined;
  /** An item that never counts: the one the query is made for. */
  except?: string | undefined;
}

/**
 * Finds an item with placeholder metadata (no author or no year) that is the same work as a
 * resolved record: the titles agree at the threshold of title matching, and whatever year and
 * first author the item does have agree too. A title that is short or a single word never
 * counts, because "Introduction" or "Copyright" names many works.
 */
export function findEnrichable(lib: Library, q: EnrichQuery): string | undefined {
  const words = normalizeText(q.title).split(" ").filter(Boolean);
  if (words.length < 3 || normalizeText(q.title).length < 15) return undefined;
  const year = yearOf(q.year);
  const author = q.firstAuthor ? normalizeText(q.firstAuthor) : undefined;
  const rows = lib.index.all<{
    citekey: string;
    title: string;
    year: string | null;
    url: string | null;
  }>(
    "SELECT citekey, title, year, url FROM items WHERE (authors IS NULL OR authors = '' OR year IS NULL) AND citekey <> ?",
    q.except ?? "",
  );
  let best: { citekey: string; similarity: number } | undefined;
  for (const r of rows) {
    const similarity = Math.max(
      titleSimilarity(r.title, q.title),
      titleSimilarity(stripSiteName(r.title, undefined, r.url ?? undefined), q.title),
    );
    if (similarity < 0.9) continue;
    if (r.year && year && Math.abs(Number(r.year) - Number(year)) > 1) continue;
    if (author) {
      const first = lib.index.get<{ family: string | null; literal: string | null }>(
        "SELECT family, literal FROM creators WHERE citekey = ? AND role = 'author' ORDER BY pos LIMIT 1",
        r.citekey,
      );
      const other = first ? normalizeText(first.family ?? first.literal ?? "") : "";
      if (other && author.split(" ").pop() !== other.split(" ").pop()) continue;
    }
    if (!best || similarity > best.similarity) best = { citekey: r.citekey, similarity };
  }
  return best?.citekey;
}
