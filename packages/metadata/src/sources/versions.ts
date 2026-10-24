/**
 * Preprint and published version of a work. Three independent sources:
 *
 * - Crossref `relation`: `is-preprint-of` on the preprint, `has-preprint` on the article. It
 *   covers Crossref preprint servers (bioRxiv, SSRN, Research Square), not arXiv.
 * - arXiv: the author-supplied `doi` and `journal_ref` name the published version.
 * - OpenAlex `locations`: one work lists the preprint and the publisher page together.
 *
 * OpenAlex can merge a famous work into a junk DOI (docs/research/metadata-sources.md section 4),
 * so its links are marked with their source and only ever used to connect two items the library
 * already holds.
 */

import { asString } from "../csl.js";
import type { VersionLink, VersionResult } from "../graph-types.js";
import { normalizeArxivId, normalizeDoi } from "../identifiers.js";
import { SourceError } from "../types.js";
import { fetchArxiv } from "./arxiv.js";
import { arxivFromDoi } from "./citations.js";
import { doiPath, type SourceContext, withMailto } from "./context.js";

type Json = Record<string, unknown>;

const CROSSREF = "https://api.crossref.org";
const OPENALEX = "https://api.openalex.org";
const WEEK = 7 * 24 * 60 * 60 * 1000;

function isArxivDoi(doi: string): boolean {
  return doi.startsWith("10.48550/arxiv.");
}

function relationDois(relation: unknown, kind: string): string[] {
  const entries = (relation as Json | undefined)?.[kind];
  return (Array.isArray(entries) ? (entries as Json[]) : [])
    .filter((e) => (asString(e["id-type"]) ?? "doi") === "doi")
    .map((e) => normalizeDoi(asString(e.id) ?? ""))
    .filter((d): d is string => !!d);
}

async function crossrefLinks(ctx: SourceContext, doi: string): Promise<VersionLink[]> {
  const res = await ctx.http.get({
    source: "crossref",
    url: withMailto(`${CROSSREF}/works/${doiPath(doi)}`, ctx.config),
    accept: "application/json",
    // A preprint gets published: do not keep the answer for a month.
    ttlMs: WEEK,
  });
  if (res.status === 404) return [];
  if (!res.ok) throw new SourceError("crossref", `HTTP ${res.status} for ${doi}`, res.status);
  const message = (JSON.parse(res.body) as { message?: Json }).message;
  const relation = message?.relation;
  return [
    ...relationDois(relation, "is-preprint-of").map(
      (d): VersionLink => ({ relation: "preprint-of", doi: d, source: "crossref" }),
    ),
    ...relationDois(relation, "has-preprint").map(
      (d): VersionLink =>
        isArxivDoi(d)
          ? { relation: "has-preprint", arxiv: arxivFromDoi(d) ?? d, source: "crossref" }
          : { relation: "has-preprint", doi: d, source: "crossref" },
    ),
  ];
}

async function arxivLinks(ctx: SourceContext, arxiv: string): Promise<VersionLink[]> {
  const rec = await fetchArxiv(ctx, arxiv);
  const published = rec?.enrichment?.publishedDoi;
  return published && !isArxivDoi(published)
    ? [{ relation: "preprint-of", doi: published, source: "arxiv" }]
    : [];
}

function locationLinks(work: Json, queriedIsArxiv: boolean): VersionLink[] {
  const out: VersionLink[] = [];
  for (const loc of Array.isArray(work.locations) ? (work.locations as Json[]) : []) {
    const url = asString(loc.landing_page_url) ?? "";
    const version = asString(loc.version);
    const arxiv = /arxiv\.org\/(?:abs|pdf)\/([^?#]+?)(?:\.pdf)?(?:v\d+)?$/i.exec(url)?.[1];
    if (arxiv && !queriedIsArxiv) {
      const id = normalizeArxivId(arxiv)?.id;
      if (id) out.push({ relation: "has-preprint", arxiv: id, source: "openalex" });
      continue;
    }
    const doi = /doi\.org\/(10\.[^?#]+)/i.exec(url)?.[1];
    const normalized = doi ? normalizeDoi(doi) : undefined;
    if (queriedIsArxiv && normalized && !isArxivDoi(normalized) && version === "publishedVersion") {
      out.push({ relation: "preprint-of", doi: normalized, source: "openalex" });
    }
  }
  return out;
}

async function openAlexLinks(
  ctx: SourceContext,
  doi: string,
  queriedIsArxiv: boolean,
): Promise<VersionLink[]> {
  const url = new URL(`${OPENALEX}/works/doi:${doiPath(doi)}`);
  url.searchParams.set("select", "id,locations");
  if (ctx.config.mailto) url.searchParams.set("mailto", ctx.config.mailto);
  if (ctx.config.openalexApiKey) url.searchParams.set("api_key", ctx.config.openalexApiKey);
  const res = await ctx.http.get({
    source: "openalex",
    url: url.toString(),
    accept: "application/json",
    ttlMs: WEEK,
  });
  if (res.status === 404) return [];
  if (!res.ok) throw new SourceError("openalex", `HTTP ${res.status} for ${doi}`, res.status);
  return locationLinks(JSON.parse(res.body) as Json, queriedIsArxiv);
}

/** The other version of a work: its published article for a preprint, its preprint for an article. */
export async function findVersions(
  ctx: SourceContext,
  key: { doi?: string; arxiv?: string },
): Promise<VersionResult> {
  const arxiv = key.arxiv ?? (key.doi ? arxivFromDoi(key.doi) : undefined);
  const doi = key.doi ?? (arxiv ? `10.48550/arxiv.${arxiv}` : undefined);
  const errors: string[] = [];
  const links: VersionLink[] = [];
  const attempt = async (name: string, run: () => Promise<VersionLink[]>): Promise<void> => {
    try {
      links.push(...(await run()));
    } catch (err) {
      errors.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  if (doi && !isArxivDoi(doi)) await attempt("crossref", () => crossrefLinks(ctx, doi));
  const queriedIsPreprint = doi === undefined || isArxivDoi(doi);
  if (arxiv && queriedIsPreprint) await attempt("arxiv", () => arxivLinks(ctx, arxiv));
  if (doi && ctx.config.openalex !== false) {
    await attempt("openalex", () => openAlexLinks(ctx, doi, isArxivDoi(doi)));
  }
  // The first source that names a target wins; later sources only repeat it.
  const seen = new Set<string>();
  const unique = links.filter((l) => {
    if (l.doi === doi) return false;
    const k = `${l.relation}|${l.doi ?? ""}|${l.arxiv ?? ""}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { links: unique, errors };
}
