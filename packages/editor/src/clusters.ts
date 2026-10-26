import { type CitationRef, scanCitations } from "@citegeist/schema";
import { LOCATOR_TERMS, labelForTerm } from "./locators";

/** One citation of a Pandoc cluster, as far as the editor understands it. */
export interface ClusterRef {
  key: string;
  /** Text before the key, such as "vgl." or "see". */
  prefix?: string;
  /** Just the number or range of the locator: "12", "12-14". */
  locator?: string;
  /** CSL label of the locator: "page", "paragraph", "chapter", ... */
  label?: string;
  /** Text after the locator. The scanner does not produce it yet. */
  suffix?: string;
  /** `[-@key]`: the author is not repeated. */
  suppressAuthor?: boolean;
}

/** A bracketed citation group such as `[vgl. @a, S. 12; @b]`. */
export interface Cluster {
  /** Offset of the opening `[`. */
  from: number;
  /** Offset after the closing `]`. */
  to: number;
  refs: ClusterRef[];
  /** False when any part could not be understood; such a cluster is shown as source text. */
  parsed: boolean;
}

const NUMBER = "\\d+[a-z]?";
const RANGE = `${NUMBER}(?:\\s*[-\u2013\u2014]\\s*${NUMBER})?(?:\\s*ff?\\.?)?`;
const escapeTerm = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s*");
const TERM_RE = new RegExp(
  `^(${LOCATOR_TERMS.map(escapeTerm).join("|")})(?:(?<=[.\u00a7\u00b6])\\s*|\\s+)(${RANGE})$`,
  "iu",
);
const BARE_RE = new RegExp(`^${RANGE}$`);

function cleanLocator(raw: string): string {
  return raw
    .replace(/\s*[\u2013\u2014]\s*/g, "-")
    .replace(/\s*-\s*/g, "-")
    .replace(/\s+/g, " ");
}

function parseLocator(text: string): { label: string; locator: string } | undefined {
  const t = text.trim();
  const m = TERM_RE.exec(t);
  if (m?.[1] && m[2]) {
    const label = labelForTerm(m[1]);
    if (label) return { label, locator: cleanLocator(m[2]) };
  }
  if (BARE_RE.test(t)) return { label: "page", locator: cleanLocator(t) };
  return undefined;
}

interface Found {
  key: string;
  /** Offset of the `@`. */
  at: number;
  /** Offset after the key (after `}` for `@{key}`). */
  end: number;
  suppress: boolean;
}

function locate(text: string, refs: readonly CitationRef[]): Found[] {
  return refs.map((ref) => {
    const braced = text.charAt(ref.from - 1) === "{";
    const at = braced ? ref.from - 2 : ref.from - 1;
    const end = braced ? text.indexOf("}", ref.to) + 1 : ref.to;
    return { key: ref.key, at, end, suppress: text.charAt(at - 1) === "-" };
  });
}

/** The `[` before `at` and the `]` that closes it, both on the same line. */
function enclosing(text: string, at: number): { open: number; close: number } | undefined {
  let open = -1;
  let skip = 0;
  for (let i = at - 1; i >= 0; i--) {
    const c = text.charAt(i);
    if (c === "\n") return undefined;
    if (text.charAt(i - 1) === "\\") continue;
    if (c === "]") skip++;
    else if (c === "[" && skip > 0) skip--;
    else if (c === "[") {
      open = i;
      break;
    }
  }
  if (open < 0) return undefined;
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text.charAt(i);
    if (c === "\n") return undefined;
    if (text.charAt(i - 1) === "\\") continue;
    if (c === "[") depth++;
    else if (c === "]" && --depth === 0) return { open, close: i + 1 };
  }
  return undefined;
}

function parseCluster(text: string, from: number, to: number, found: Found[]): Cluster {
  const refs: ClusterRef[] = [];
  const cluster: Cluster = { from, to, refs, parsed: false };
  const next = text.charAt(to);
  // `[text](url)`, `[text][ref]` and `[text]{.class}` are links or spans, not citations.
  const inner = text.slice(from + 1, to - 1);
  const linked = next === "(" || next === "[" || next === "{";
  let parsed = !linked && !inner.includes("[");
  let offset = from + 1;
  for (const part of inner.split(";")) {
    const start = offset;
    const end = offset + part.length;
    offset = end + 1;
    const inPart = found.filter((f) => f.at >= start && f.end <= end);
    const only = inPart[0];
    if (inPart.length !== 1 || !only) {
      parsed = false;
      for (const f of inPart) refs.push({ key: f.key });
      continue;
    }
    const ref: ClusterRef = { key: only.key };
    const prefix = text.slice(start, only.suppress ? only.at - 1 : only.at).trim();
    if (prefix) ref.prefix = prefix;
    if (only.suppress) ref.suppressAuthor = true;
    const rest = text.slice(only.end, end).trim();
    if (rest) {
      const loc = rest.startsWith(",") ? parseLocator(rest.slice(1)) : undefined;
      if (loc) {
        ref.locator = loc.locator;
        ref.label = loc.label;
      } else {
        parsed = false;
      }
    }
    refs.push(ref);
  }
  cluster.parsed = parsed && refs.length > 0;
  return cluster;
}

/**
 * Finds the bracketed citation clusters of a text: `[@a]`, `[vgl. @a, S. 12; @b]`, `[-@a]`. Real
 * citations come from the export's scanner, so code, links, escapes and frontmatter never count.
 * A bare `@key` outside brackets is not a cluster. Every bracketed key lies in exactly one
 * cluster; `parsed` is false when any part is not understood.
 */
export function scanClusters(text: string): Cluster[] {
  return clustersOf(text, scanCitations(text));
}

/** `scanClusters` for a caller that has scanned the citations already. */
export function clustersOf(text: string, refs: readonly CitationRef[]): Cluster[] {
  const found = locate(text, refs);
  const clusters: Cluster[] = [];
  let last = -1;
  for (const f of found) {
    if (f.at < last) continue;
    const span = enclosing(text, f.at);
    if (!span) continue;
    const inside = found.filter((x) => x.at > span.open && x.end < span.close);
    clusters.push(parseCluster(text, span.open, span.close, inside));
    last = span.close;
  }
  return clusters;
}
