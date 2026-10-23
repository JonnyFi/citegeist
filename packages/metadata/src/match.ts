/**
 * Title matching for PDFs without an identifier.
 *
 * A search hit is accepted only if all four checks hold, never because of a search score:
 *
 * 1. title similarity at least TITLE_THRESHOLD (0.9) on normalised titles,
 * 2. the first author's family name equals the candidate's first author (or editor),
 * 3. the year differs by at most one (preprint versus print),
 * 4. the item types are compatible (a chapter about a book is not the book).
 *
 * If one check fails the candidate is rejected. If a check cannot be made because the query lacks
 * the data (no author, year or type), the verdict is "review": a person or agent decides, the
 * resolver never accepts on partial evidence.
 *
 * Why not the Crossref score: for Luhmann's "Soziale Systeme" the top hit (score 111) is a
 * handbook chapter about the book, and for "The strength of weak ties" it is a 2003 reprint
 * chapter. Both pass a title check, only author, year and type tell the truth.
 */

import { foldForCompare } from "./text.js";
import type { Creator, MetadataFields } from "./types.js";

export const TITLE_THRESHOLD = 0.9;
export const YEAR_TOLERANCE = 1;

export interface TitleQuery {
  title: string;
  /** Family name or full name of the first author as read from the PDF header. */
  firstAuthor?: string;
  year?: number;
  /** CSL type guessed from the header, e.g. "article-journal" or "book". */
  type?: NonNullable<MetadataFields["type"]>;
}

export type Check = "title" | "author" | "year" | "type";

export type Verdict = "accept" | "review" | "reject";

export interface ScoredCandidate {
  candidate: MetadataFields;
  titleSimilarity: number;
  /** Checks that failed because the data disagrees. */
  failed: Check[];
  /** Checks that could not be made because the query lacks the data. */
  unverified: Check[];
  verdict: Verdict;
}

export interface MatchResult {
  verdict: Verdict;
  /** Set for "accept" only. */
  accepted?: MetadataFields;
  /** All candidates, best first. For "review" show the first three to the user. */
  scored: ScoredCandidate[];
}

/** Type groups. Journal articles, preprints and conference papers are one group on purpose: the same work appears in each. */
const TYPE_GROUPS: string[][] = [
  [
    "article-journal",
    "article",
    "paper-conference",
    "review",
    "article-magazine",
    "article-newspaper",
  ],
  ["book", "collection", "classic", "periodical"],
  ["chapter", "entry", "entry-dictionary", "entry-encyclopedia"],
  ["thesis"],
  ["report"],
  ["dataset"],
  ["software"],
];

export function typesCompatible(a: string, b: string): boolean {
  if (a === b) return true;
  return TYPE_GROUPS.some((g) => g.includes(a) && g.includes(b));
}

function tokens(s: string): string[] {
  return foldForCompare(s)
    .split(" ")
    .filter((t) => t.length > 0);
}

/** F1 of the token overlap (multiset). */
function tokenF1(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const t of a) counts.set(t, (counts.get(t) ?? 0) + 1);
  let overlap = 0;
  for (const t of b) {
    const n = counts.get(t) ?? 0;
    if (n > 0) {
      overlap++;
      counts.set(t, n - 1);
    }
  }
  return (2 * overlap) / (a.length + b.length);
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0] as number;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j] as number;
      prev[j] = Math.min(
        (prev[j] as number) + 1,
        (prev[j - 1] as number) + 1,
        diag + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      diag = tmp;
    }
  }
  return prev[b.length] as number;
}

function charSimilarity(a: string, b: string): number {
  const x = foldForCompare(a);
  const y = foldForCompare(b);
  const max = Math.max(x.length, y.length);
  return max === 0 ? 0 : 1 - levenshtein(x, y) / max;
}

/** Colon, en dash or em dash followed by space, or a full stop before a capital letter. */
const SUBTITLE_BREAK = new RegExp(
  `\\s*[:${String.fromCodePoint(0x2013, 0x2014)}]\\s+|\\.\\s+(?=[A-Z\\u00c0-\\u00de])`,
);

function mainTitle(s: string): string {
  return s.split(SUBTITLE_BREAK)[0] ?? s;
}

function hasSubtitle(s: string): boolean {
  return mainTitle(s).length < s.trim().length;
}

/**
 * Similarity in [0, 1]: the larger of token F1 and character similarity, which tolerates OCR
 * noise and word order. If only one side has a subtitle, the main titles are compared too.
 */
export function titleSimilarity(a: string, b: string): number {
  const full = Math.max(tokenF1(tokens(a), tokens(b)), charSimilarity(a, b));
  if (hasSubtitle(a) !== hasSubtitle(b)) {
    const ma = mainTitle(a);
    const mb = mainTitle(b);
    const main = Math.max(tokenF1(tokens(ma), tokens(mb)), charSimilarity(ma, mb));
    return Math.max(full, main);
  }
  return full;
}

function familyOf(name: string): string {
  const folded = foldForCompare(name.includes(",") ? (name.split(",")[0] ?? name) : name);
  return folded.split(" ").pop() ?? folded;
}

function candidateFirstFamily(c: MetadataFields): string | undefined {
  const first = c.author?.[0] ?? c.editor?.[0];
  return first ? creatorFamily(first) : undefined;
}

function creatorFamily(c: Creator): string {
  const raw = "family" in c ? c.family : c.literal;
  const folded = foldForCompare(raw);
  return folded.split(" ").pop() ?? folded;
}

function yearOf(issued: MetadataFields["issued"]): number | undefined {
  if (issued === undefined) return undefined;
  const y = typeof issued === "number" ? issued : Number(String(issued).slice(0, 4));
  return Number.isFinite(y) ? y : undefined;
}

export function scoreCandidate(query: TitleQuery, candidate: MetadataFields): ScoredCandidate {
  const failed: Check[] = [];
  const unverified: Check[] = [];

  const similarity = candidate.title ? titleSimilarity(query.title, candidate.title) : 0;
  if (similarity < TITLE_THRESHOLD) failed.push("title");

  const candFamily = candidateFirstFamily(candidate);
  if (!query.firstAuthor) unverified.push("author");
  else if (!candFamily || familyOf(query.firstAuthor) !== candFamily) failed.push("author");

  const candYear = yearOf(candidate.issued);
  if (query.year === undefined) unverified.push("year");
  else if (candYear === undefined || Math.abs(candYear - query.year) > YEAR_TOLERANCE) {
    failed.push("year");
  }

  if (!query.type) unverified.push("type");
  else if (!candidate.type || !typesCompatible(query.type, candidate.type)) failed.push("type");

  const verdict: Verdict =
    failed.length > 0 ? "reject" : unverified.length > 0 ? "review" : "accept";
  return { candidate, titleSimilarity: similarity, failed, unverified, verdict };
}

/**
 * Picks the candidate for a header-derived query. Two accepted candidates with different DOIs and
 * nearly equal similarity are ambiguous and downgrade to "review".
 */
export function matchTitle(query: TitleQuery, candidates: MetadataFields[]): MatchResult {
  const scored = candidates
    .map((c) => scoreCandidate(query, c))
    .sort((a, b) => rank(a) - rank(b) || b.titleSimilarity - a.titleSimilarity);

  const accepted = scored.filter((s) => s.verdict === "accept");
  const best = accepted[0];
  if (best) {
    const rival = accepted[1];
    const ambiguous =
      rival !== undefined &&
      rival.candidate.DOI !== best.candidate.DOI &&
      best.titleSimilarity - rival.titleSimilarity < 0.02;
    if (!ambiguous) return { verdict: "accept", accepted: best.candidate, scored };
    return { verdict: "review", scored };
  }
  const review = scored.some((s) => s.verdict === "review");
  return { verdict: review ? "review" : "reject", scored };
}

function rank(s: ScoredCandidate): number {
  return s.verdict === "accept" ? 0 : s.verdict === "review" ? 1 : 2;
}
