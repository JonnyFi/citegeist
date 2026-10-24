import { asString } from "../csl.js";
import { compact } from "../text.js";
import { type Enrichment, SourceError, type SourceRecord } from "../types.js";
import { doiPath, makeRecord, type SourceContext } from "./context.js";

type Json = Record<string, unknown>;

const BASE = "https://api.unpaywall.org/v2";

/**
 * Open-access status and PDF location of a DOI from Unpaywall. Unpaywall requires an email
 * address on every call, so nothing is requested without `unpaywallEmail` or `mailto` in the config. The answer
 * is a record without citation fields: only its `openAccess` enrichment counts. Unpaywall knows
 * Crossref DOIs only; DataCite DOIs answer 404 and come back as undefined.
 */
export async function fetchUnpaywall(
  ctx: SourceContext,
  doi: string,
): Promise<SourceRecord | undefined> {
  const email = ctx.config.unpaywallEmail ?? ctx.config.mailto;
  if (!email) return undefined;
  const res = await ctx.http.get({
    source: "unpaywall",
    url: `${BASE}/${doiPath(doi)}?email=${encodeURIComponent(email)}`,
    accept: "application/json",
  });
  if (res.status === 404 || res.status === 422) return undefined;
  if (!res.ok) throw new SourceError("unpaywall", `HTTP ${res.status} for ${doi}`, res.status);
  let body: Json;
  try {
    body = JSON.parse(res.body) as Json;
  } catch {
    throw new SourceError("unpaywall", `response for ${doi} is not JSON`);
  }
  return makeRecord("unpaywall", doi, res.fetchedAt, {}, mapUnpaywall(body));
}

const VERSION_RANK: Record<string, number> = {
  publishedVersion: 0,
  acceptedVersion: 1,
  submittedVersion: 2,
};

export function mapUnpaywall(body: Json): Enrichment {
  const best = (body.best_oa_location ?? undefined) as Json | undefined;
  const locations = Array.isArray(body.oa_locations) ? (body.oa_locations as Json[]) : [];
  // The best location may be a landing page only; a direct PDF elsewhere is still better for ingest.
  const withPdf = [best, ...locations]
    .filter((l): l is Json => !!l && typeof l.url_for_pdf === "string" && l.url_for_pdf !== "")
    .sort(
      (a, b) =>
        (VERSION_RANK[asString(a.version) ?? ""] ?? 3) -
        (VERSION_RANK[asString(b.version) ?? ""] ?? 3),
    )[0];
  const pdf = withPdf ?? best;
  return {
    openAccess: compact({
      isOa: body.is_oa === true,
      pdfUrl: asString(withPdf?.url_for_pdf),
      landingUrl: asString(pdf?.url),
      license: asString(pdf?.license),
    }),
  };
}
