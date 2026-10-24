import type { GraphWork, MarkedWork } from "@citegeist/ops";
import { findDuplicate } from "../ingest/dupes.js";
import type { Library } from "../library.js";

export interface Counts {
  library: number;
  inbox: number;
  new: number;
}

/** First family name of "Harris, Millman, van der Walt" or "Vaswani et al.". */
function firstFamily(authors: string | undefined): string | undefined {
  const first = authors
    ?.split(",")[0]
    ?.replace(/\s+et al\.?$/i, "")
    .trim();
  return first ? first : undefined;
}

/**
 * The library item that is this work, or undefined. Matching goes by identifier first (DOI,
 * arXiv id, OpenAlex id, PMID), and by title, year and first author last.
 */
export function findInLibrary(lib: Library, work: GraphWork): string | undefined {
  const idx = lib.index;
  const byId = findDuplicate(lib, {
    doi: work.doi,
    arxiv: work.arxiv,
    title: work.title && work.year !== undefined ? work.title : undefined,
    year: work.year,
    firstAuthor: firstFamily(work.authors),
  });
  if (byId) return byId;
  if (work.openalex) {
    const row = idx.get<{ citekey: string }>(
      "SELECT citekey FROM items WHERE json_extract(frontmatter_json, '$.ids.openalex') = ?",
      work.openalex,
    );
    if (row) return row.citekey;
  }
  if (work.pmid) {
    const row = idx.get<{ citekey: string }>(
      "SELECT citekey FROM items WHERE json_extract(frontmatter_json, '$.ids.pmid') = ?",
      work.pmid,
    );
    if (row) return row.citekey;
  }
  return undefined;
}

/** A work can be added when it carries an identifier that items.add understands. */
export function isAddable(work: GraphWork): boolean {
  return Boolean(work.doi || work.arxiv || work.openalex);
}

/** Marks each work as in the library, in the inbox or new. */
export function markWorks(
  lib: Library,
  works: GraphWork[],
): { marked: MarkedWork[]; counts: Counts } {
  const counts: Counts = { library: 0, inbox: 0, new: 0 };
  const marked = works.map((work): MarkedWork => {
    const citekey = findInLibrary(lib, work);
    const inbox = citekey
      ? (lib.index.get<{ inbox: number }>("SELECT inbox FROM items WHERE citekey = ?", citekey)
          ?.inbox ?? 0) === 1
      : false;
    const status = citekey ? (inbox ? "inbox" : "library") : "new";
    counts[status]++;
    return { ...work, status, ...(citekey ? { citekey } : {}), addable: isAddable(work) };
  });
  return { marked, counts };
}
