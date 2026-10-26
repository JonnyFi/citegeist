/**
 * Retractions and corrections of a DOI (internal metadata-sources research section 2). Crossref
 * carries the Retraction Watch data in production since January 2025: the original article lists
 * `updated-by`, the notice lists `update-to`, and each entry names its source (`publisher` or
 * `retraction-watch`). OpenAlex `is_retracted` is the backup for DOIs Crossref does not know.
 *
 * Nothing here uses the response cache: a retraction check that returns last month's answer
 * would defeat its purpose.
 */

import { asString } from "../csl.js";
import {
  classifyUpdateType,
  type NoticeSource,
  type RetractionNotice,
  type RetractionStatus,
} from "../graph-types.js";
import { normalizeDoi } from "../identifiers.js";
import { compact, dateFromParts, isoDate } from "../text.js";
import { SourceError } from "../types.js";
import { doiPath, type SourceContext, withMailto } from "./context.js";

type Json = Record<string, unknown>;

const CROSSREF = "https://api.crossref.org";
const OPENALEX = "https://api.openalex.org";

async function crossrefJson(ctx: SourceContext, source: string, url: string) {
  const res = await ctx.http.get({
    source,
    url: withMailto(url, ctx.config),
    accept: "application/json",
    noCache: true,
  });
  if (res.status === 404) return undefined;
  if (!res.ok) throw new SourceError("crossref", `HTTP ${res.status}`, res.status);
  try {
    return (JSON.parse(res.body) as { message?: Json }).message;
  } catch {
    throw new SourceError("crossref", "response is not JSON");
  }
}

function noticeSource(raw: string | undefined): NoticeSource {
  return raw === "retraction-watch" ? "retraction-watch" : "publisher";
}

function entryDate(updated: unknown): string | undefined {
  const u = updated as Json | undefined;
  return dateFromParts(u?.["date-parts"]) ?? asString(u?.["date-time"])?.slice(0, 10) ?? undefined;
}

/** One `updated-by` or `update-to` entry as a notice. `doi` is the notice DOI of that entry. */
function toNotice(entry: Json, noticeDoi: string | undefined): RetractionNotice | undefined {
  const kind = classifyUpdateType(asString(entry.type));
  if (!kind) return undefined;
  return compact<RetractionNotice>({
    kind,
    label: asString(entry.label),
    doi: noticeDoi,
    date: entryDate(entry.updated),
    source: noticeSource(asString(entry.source)),
    recordId: asString(entry["record-id"]),
  });
}

function dedupe(notices: RetractionNotice[]): RetractionNotice[] {
  const seen = new Set<string>();
  const out: RetractionNotice[] = [];
  for (const n of notices) {
    // The same notice shows up once from `updated-by` and once from the notice's `update-to`.
    const key = n.doi ? `${n.kind}|${n.doi}` : `${n.kind}|${n.date ?? ""}|${n.source}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(n);
  }
  return out;
}

/**
 * Retraction and correction notices of a DOI.
 *
 * 1. The Crossref record of the DOI: `updated-by` lists notices about it, `update-to` says the
 *    DOI is itself a notice for other works.
 * 2. The notices that name the DOI in their `update-to` (`filter=updates:<doi>`), which also
 *    finds notices the original record does not list yet.
 * 3. OpenAlex `is_retracted`, only when Crossref does not know the DOI.
 */
export async function fetchRetractionStatus(
  ctx: SourceContext,
  doiInput: string,
): Promise<RetractionStatus> {
  const doi = normalizeDoi(doiInput) ?? doiInput.toLowerCase();
  const checkedAt = isoDate(ctx.now());
  const work = await crossrefJson(ctx, "crossref", `${CROSSREF}/works/${doiPath(doi)}`);
  if (!work) {
    return openAlexFallback(ctx, doi, checkedAt);
  }

  const notices: RetractionNotice[] = [];
  for (const entry of Array.isArray(work["updated-by"]) ? (work["updated-by"] as Json[]) : []) {
    const n = toNotice(entry, normalizeDoi(asString(entry.DOI) ?? ""));
    if (n) notices.push(n);
  }
  const noticeFor = (Array.isArray(work["update-to"]) ? (work["update-to"] as Json[]) : [])
    .filter((e) => classifyUpdateType(asString(e.type)) !== undefined)
    .map((e) => normalizeDoi(asString(e.DOI) ?? ""))
    .filter((d): d is string => !!d);

  const list = new URL(`${CROSSREF}/works`);
  list.searchParams.set("filter", `updates:${doi}`);
  list.searchParams.set("rows", "20");
  list.searchParams.set("select", "DOI,update-to");
  const found = await crossrefJson(ctx, "crossref-list", list.toString());
  for (const item of Array.isArray(found?.items) ? (found.items as Json[]) : []) {
    const noticeDoi = normalizeDoi(asString(item.DOI) ?? "");
    for (const entry of Array.isArray(item["update-to"]) ? (item["update-to"] as Json[]) : []) {
      if (normalizeDoi(asString(entry.DOI) ?? "") !== doi) continue;
      const n = toNotice(entry, noticeDoi);
      if (n) notices.push(n);
    }
  }
  return { doi, known: true, notices: dedupe(notices), noticeFor, checkedAt };
}

async function openAlexFallback(
  ctx: SourceContext,
  doi: string,
  checkedAt: string,
): Promise<RetractionStatus> {
  const unknown: RetractionStatus = { doi, known: false, notices: [], noticeFor: [], checkedAt };
  if (ctx.config.openalex === false) return unknown;
  const url = new URL(`${OPENALEX}/works/doi:${doiPath(doi)}`);
  url.searchParams.set("select", "id,is_retracted");
  if (ctx.config.mailto) url.searchParams.set("mailto", ctx.config.mailto);
  if (ctx.config.openalexApiKey) url.searchParams.set("api_key", ctx.config.openalexApiKey);
  const res = await ctx.http.get({
    source: "openalex",
    url: url.toString(),
    accept: "application/json",
    noCache: true,
  });
  if (res.status === 404) return unknown;
  if (!res.ok) throw new SourceError("openalex", `HTTP ${res.status} for ${doi}`, res.status);
  let work: Json;
  try {
    work = JSON.parse(res.body) as Json;
  } catch {
    throw new SourceError("openalex", `response for ${doi} is not JSON`);
  }
  return {
    ...unknown,
    known: true,
    notices:
      work.is_retracted === true
        ? [{ kind: "retraction", label: "Retracted (OpenAlex)", source: "openalex" }]
        : [],
  };
}
