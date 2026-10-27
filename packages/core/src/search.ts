import type { Index, Scope } from "./index-db.js";
import { scopeClauses } from "./index-db.js";
import { snippet, trigramQuery, wordsQuery } from "./text.js";

export type HitKind = "item" | "card" | "note" | "block";

export interface SearchInput extends Scope {
  q: string;
  kinds?: HitKind[];
  limit?: number;
}

export interface SearchHit {
  kind: HitKind;
  id: string;
  citekey?: string;
  /** The hit belongs to an item that waits in the inbox. */
  inbox?: true;
  title: string;
  snippet: string;
  page?: string;
  score: number;
}

interface DocRow {
  id: number;
  kind: HitKind;
  ref: string;
  citekey: string | null;
  title: string;
}

const RRF_K = 60;

/**
 * Full-text search over the stemmed word table (German and English) and the trigram table, fused
 * by reciprocal rank. Every hit satisfies the scope filters.
 */
export function search(index: Index, input: SearchInput): SearchHit[] {
  const limit = input.limit ?? 20;
  const kinds = input.kinds ?? ["item", "card", "note", "block"];
  if (kinds.length === 0) return [];
  const scope = scopeClauses(input, {
    ownerKind: "(CASE WHEN d.kind = 'block' THEN 'item' ELSE d.kind END)",
    ownerRef: "(CASE WHEN d.kind = 'block' THEN d.citekey ELSE d.ref END)",
    citekey: "d.citekey",
  });

  const run = (table: "fts_words" | "fts_tri", match: string): DocRow[] =>
    index.all<DocRow>(
      `SELECT d.id, d.kind, d.ref, d.citekey, d.title
       FROM ${table} JOIN docs d ON d.id = ${table}.rowid
       WHERE ${table} MATCH ? AND d.kind IN (${kinds.map(() => "?").join(",")})
       ${scope.sql.map((s) => `AND ${s}`).join(" ")}
       ORDER BY bm25(${table}, 5.0, 1.0) LIMIT ?`,
      match,
      ...kinds,
      ...scope.params,
      limit * 3,
    );

  const wq = wordsQuery(input.q);
  const tq = trigramQuery(input.q);
  const lists: DocRow[][] = [];
  if (wq) lists.push(run("fts_words", wq));
  if (tq) lists.push(run("fts_tri", tq));

  const fused = new Map<number, { doc: DocRow; score: number }>();
  for (const list of lists) {
    for (const [rank, doc] of list.entries()) {
      const entry = fused.get(doc.id) ?? { doc, score: 0 };
      entry.score += 1 / (RRF_K + rank + 1);
      fused.set(doc.id, entry);
    }
  }
  const ranked = [...fused.values()].sort((a, b) => b.score - a.score).slice(0, limit);

  const titles = new Map<string, string>();
  const itemTitle = (citekey: string): string => {
    let t = titles.get(citekey);
    if (t === undefined) {
      t = index.get<{ title: string }>("SELECT title FROM items WHERE citekey = ?", citekey)?.title;
      titles.set(citekey, t ?? citekey);
    }
    return titles.get(citekey) ?? citekey;
  };

  return ranked.map(({ doc, score }) => {
    const text =
      index.get<{ body: string }>("SELECT body FROM fts_tri WHERE rowid = ?", doc.id)?.body ?? "";
    const hit: SearchHit = {
      kind: doc.kind,
      id: doc.kind === "block" ? doc.ref.slice(doc.ref.indexOf(":") + 1) : doc.ref,
      title: doc.kind === "block" && doc.citekey ? itemTitle(doc.citekey) : doc.title,
      snippet: snippet(text, input.q),
      score,
    };
    if (doc.citekey) hit.citekey = doc.citekey;
    if (doc.kind === "block" && doc.citekey) {
      const sep = doc.ref.indexOf(":");
      const page = index.get<{ page: string | null }>(
        "SELECT page FROM blocks WHERE citekey = ? AND source = ? AND id = ?",
        doc.citekey,
        doc.ref.slice(0, sep),
        doc.ref.slice(sep + 1),
      )?.page;
      if (page) hit.page = page;
    }
    return hit;
  });
}
