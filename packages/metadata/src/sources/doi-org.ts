import { mapCslLike } from "../csl.js";
import { splitPersonName } from "../text.js";
import {
  type Creator,
  type Enrichment,
  type MetadataFields,
  SourceError,
  type SourceRecord,
} from "../types.js";
import { doiPath, makeRecord, type SourceContext } from "./context.js";

const ORG_WORDS =
  /\b(university|universit[aä]t|institute?|institut|group|team|consortium|collaboration|project|lab|laboratory|commission|committee|association|society|center|centre|council|network|foundation|department|agency|company|inc|gmbh)\b|&/i;

/**
 * DataCite CSL often carries a person as one string in `family` ("Tanguy Fardet"). Two or three
 * capitalised words without organisation vocabulary are split into given and family name.
 */
function splitSingleStringNames(list: Creator[] | undefined): Creator[] | undefined {
  return list?.map((c) => {
    if (!("family" in c) || c.given) return c;
    const tokens = c.family.split(/\s+/);
    const looksLikePerson =
      tokens.length >= 2 &&
      tokens.length <= 3 &&
      tokens.every((t) => /^\p{Lu}/u.test(t)) &&
      !ORG_WORDS.test(c.family);
    if (!looksLikePerson) return c;
    const split = splitPersonName(c.family);
    return "family" in split
      ? { ...c, family: split.family, ...(split.given ? { given: split.given } : {}) }
      : c;
  });
}

/**
 * CSL-JSON through doi.org content negotiation. One code path for every registration agency that
 * Crossref does not cover: DataCite, mEDRA, JaLC, EU Publications Office.
 */
export async function fetchDoiCsl(
  ctx: SourceContext,
  doi: string,
): Promise<SourceRecord | undefined> {
  const res = await ctx.http.get({
    source: "doi.org",
    url: `https://doi.org/${doiPath(doi)}`,
    accept: "application/vnd.citationstyles.csl+json",
  });
  // 204: the RA has no metadata, 404: unknown DOI, 406: format not offered.
  if ([204, 404, 406].includes(res.status)) return undefined;
  if (!res.ok) throw new SourceError("doi.org", `HTTP ${res.status} for ${doi}`, res.status);
  let json: unknown;
  try {
    json = JSON.parse(res.body);
  } catch {
    throw new SourceError("doi.org", `response for ${doi} is not JSON`);
  }
  if (typeof json !== "object" || json === null) {
    throw new SourceError("doi.org", `unexpected response for ${doi}`);
  }
  const mapped = mapCslLike(json as Record<string, unknown>);
  if (!mapped.title) return undefined;
  const fields: MetadataFields = { ...mapped, DOI: doi };
  const author = splitSingleStringNames(mapped.author);
  if (author) fields.author = author;
  const editor = splitSingleStringNames(mapped.editor);
  if (editor) fields.editor = editor;

  // OpenAlex locations for arXiv DOIs are unreliable, so name the arXiv file ourselves.
  const arxiv = fields.ids?.arxiv;
  const enrichment: Enrichment | undefined = arxiv
    ? {
        openAccess: {
          isOa: true,
          pdfUrl: `https://arxiv.org/pdf/${arxiv}`,
          landingUrl: `https://arxiv.org/abs/${arxiv}`,
        },
      }
    : undefined;
  return makeRecord("doi.org", doi, res.fetchedAt, fields, enrichment);
}
