import type { PdfLocation } from "@citegeist/metadata";

// Pure helpers of the full text lookup: which PDF addresses to try and in which order, how known
// repositories hide the real file behind a viewer address, and where an HTML page names a PDF.

/** At most this many candidate addresses are tried per lookup. */
export const MAX_CANDIDATES = 6;
/** At most this many HTTP requests (rewrites and links found in pages included) per lookup. */
export const MAX_REQUESTS = 14;
/** At most this many PDF links are followed from one HTML page. */
export const MAX_PAGE_LINKS = 2;

// Rewrites ------------------------------------------------------------------------------------

export interface RepositoryRewrite {
  name: string;
  /** Matches the whole address. */
  pattern: RegExp;
  /** Replacement; $1.. refer to the groups of the pattern. */
  to: string;
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/**
 * Viewer addresses that answer with an HTML application, mapped to the address that serves the
 * file. Keep this table small: a rule belongs here only when the viewer address never returns the
 * file itself. Addresses that are direct already (DSpace 6 `/bitstream/handle/.../file.pdf`,
 * `/server/api/core/bitstreams/<uuid>/content`, EPrints `/id/eprint/.../file.pdf`) need no rule.
 * The original address is still tried after the rewritten one.
 */
export const REPOSITORY_REWRITES: readonly RepositoryRewrite[] = [
  {
    // DSpace 7: the Angular UI serves /bitstreams/<uuid>/download as an HTML page; the REST API
    // on the same host has the file. The UI may sit under a path prefix, the API does not.
    name: "dspace7-bitstream",
    pattern: new RegExp(
      `^(https?://[^/?#]+)/(?:[^?#]*/)?bitstreams/(${UUID})(?:/download)?/?(?:[?#].*)?$`,
      "i",
    ),
    to: "$1/server/api/core/bitstreams/$2/content",
  },
  {
    // Open Journal Systems: /article/view/<article>/<galley> opens a viewer, /download/ the file.
    name: "ojs-galley",
    pattern: /^(https?:\/\/[^?#]+\/article)\/view\/(\d+)\/(\d+)\/?(?:[?#].*)?$/i,
    to: "$1/download/$2/$3",
  },
];

/** The address that really serves the file, when a known repository rule applies. */
export function rewriteRepositoryUrl(url: string): { url: string; rule: string } | undefined {
  for (const rule of REPOSITORY_REWRITES) {
    if (rule.pattern.test(url)) return { url: url.replace(rule.pattern, rule.to), rule: rule.name };
  }
  return undefined;
}

// Candidates ----------------------------------------------------------------------------------

export type OpenAccessSource = "unpaywall" | "openalex";

export interface PdfCandidate {
  url: string;
  /** Every source that named this address, in the order they were asked. */
  sources: OpenAccessSource[];
  version?: PdfLocation["version"];
  hostType?: PdfLocation["hostType"];
}

const VERSION_RANK: Record<string, number> = {
  publishedVersion: 0,
  acceptedVersion: 1,
  submittedVersion: 2,
};

/** Sites that copy papers from elsewhere. A repository or the publisher comes first. */
const AGGREGATORS = [
  "researchgate.net",
  "academia.edu",
  "semanticscholar.org",
  "core.ac.uk",
  "citeseerx.ist.psu.edu",
  "scholar.archive.org",
  "paperity.org",
  "scienceopen.com",
];

/** Hosts a page may point to besides its own, when it links a PDF in an anchor. */
const REPOSITORY_HOSTS = [
  "zenodo.org",
  "arxiv.org",
  "europepmc.org",
  "ncbi.nlm.nih.gov",
  "osf.io",
  "figshare.com",
  "hal.science",
  "hdl.handle.net",
];

function hostMatches(host: string, list: readonly string[]): boolean {
  return list.some((h) => host === h || host.endsWith(`.${h}`));
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "invalid address";
  }
}

export function isAggregator(url: string): boolean {
  return hostMatches(hostOf(url), AGGREGATORS);
}

function sameAddress(a: string, b: string): boolean {
  return a.replace(/#.*$/, "") === b.replace(/#.*$/, "");
}

/** The addresses of all sources in one list; one that several sources name appears once. */
export function mergeCandidates(
  groups: { source: OpenAccessSource; locations: readonly (string | PdfLocation)[] }[],
): PdfCandidate[] {
  const out: PdfCandidate[] = [];
  for (const { source, locations } of groups) {
    for (const loc of locations) {
      const l: PdfLocation = typeof loc === "string" ? { url: loc } : loc;
      if (!/^https?:\/\//i.test(l.url)) continue;
      const known = out.find((c) => sameAddress(c.url, l.url));
      if (known) {
        if (!known.sources.includes(source)) known.sources.push(source);
        known.version ??= l.version;
        known.hostType ??= l.hostType;
        continue;
      }
      out.push({
        url: l.url,
        sources: [source],
        ...(l.version ? { version: l.version } : {}),
        ...(l.hostType ? { hostType: l.hostType } : {}),
      });
    }
  }
  return out;
}

/**
 * Published version first, then accepted, then submitted, an unknown version last. Within a
 * version, a publisher or repository comes before an aggregator. Equal rank keeps the order the
 * sources gave (Unpaywall before OpenAlex, each source's best location first).
 */
export function orderCandidates(candidates: readonly PdfCandidate[]): PdfCandidate[] {
  const rank = (c: PdfCandidate): [number, number] => [
    VERSION_RANK[c.version ?? ""] ?? 3,
    isAggregator(c.url) ? 1 : 0,
  ];
  return candidates
    .map((c, i) => ({ c, i, r: rank(c) }))
    .sort((a, b) => a.r[0] - b.r[0] || a.r[1] - b.r[1] || a.i - b.i)
    .map((x) => x.c);
}

// Pages ---------------------------------------------------------------------------------------

function absolute(href: string, base: string): string | undefined {
  try {
    const url = new URL(decodeEntities(href.trim()), base).toString();
    return /^https?:/i.test(url) ? url : undefined;
  } catch {
    return undefined;
  }
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function attr(tag: string, name: string): string | undefined {
  return new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i")
    .exec(tag)
    ?.slice(1, 3)
    .find((v) => v !== undefined);
}

/** PDF links a publisher page names in its citation_pdf_url meta tags, as absolute URLs. */
export function citationPdfUrls(html: string, base: string): string[] {
  const out: string[] = [];
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    if (!/\bname\s*=\s*["']citation_pdf_url["']/i.test(tag)) continue;
    const content = /\bcontent\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (!content) continue;
    const url = absolute(content, base);
    if (url && !out.includes(url)) out.push(url);
  }
  return out;
}

/** May an anchor on a page at `page` point to `link`: same site, or a known repository. */
export function mayFollow(page: string, link: string): boolean {
  const strip = (h: string): string => h.replace(/^www\./, "");
  const a = strip(hostOf(page));
  const b = strip(hostOf(link));
  return a === b || hostMatches(b, REPOSITORY_HOSTS);
}

const SCAN_LIMIT = 1_000_000;
const MAX_ANCHORS = 500;

/**
 * Where an HTML page names its PDF, most reliable first: the citation_pdf_url meta tag, a
 * `<link rel="alternate" type="application/pdf">`, and an anchor whose address ends in .pdf or
 * contains /download and whose text (or title) says PDF, download or full text. Anchors are
 * followed only on the same site or on a known repository. Bounded in size and in count.
 */
export function findPdfLinks(html: string, base: string, limit = MAX_PAGE_LINKS): string[] {
  const text = html.slice(0, SCAN_LIMIT);
  const out: string[] = [];
  const add = (url: string | undefined): void => {
    if (url && !sameAddress(url, base) && !out.some((o) => sameAddress(o, url))) out.push(url);
  };
  for (const url of citationPdfUrls(text, base)) add(url);
  for (const tag of text.match(/<link\b[^>]*>/gi) ?? []) {
    if (!/\brel\s*=\s*["'][^"']*\balternate\b/i.test(tag)) continue;
    if (!/\btype\s*=\s*["']application\/pdf["']/i.test(tag)) continue;
    const href = attr(tag, "href");
    if (href) add(absolute(href, base));
  }
  let seen = 0;
  for (const m of text.matchAll(/<a\b([^>]*)>([\s\S]{0,400}?)<\/a>/gi)) {
    if (++seen > MAX_ANCHORS || out.length >= limit) break;
    const attrs = m[1] ?? "";
    const href = attr(attrs, "href");
    const url = href ? absolute(href, base) : undefined;
    if (!url || !mayFollow(base, url)) continue;
    let path: string;
    try {
      path = new URL(url).pathname;
    } catch {
      continue;
    }
    if (!/\.pdf$/i.test(path) && !/\/download(\/|$)/i.test(path)) continue;
    const label = `${(m[2] ?? "").replace(/<[^>]*>/g, " ")} ${attr(attrs, "title") ?? ""} ${attr(attrs, "aria-label") ?? ""}`;
    if (/pdf|download|full[\s-]?text/i.test(label)) add(url);
  }
  return out.slice(0, limit);
}
