import {
  detectIdentifier,
  type Identifier,
  type ResolveResult,
  type TitleResolveResult,
} from "@citegeist/metadata";
import type { Actor } from "@citegeist/schema";
import type { Library } from "../library.js";
import { loadItem, problem, saveItem } from "./items.js";
import type { MetadataLookup } from "./service.js";

/** Provenance written by a person or an agent: `human@2026-10-24`, `agent:grok@2026-10-24`. */
const EDITED_BY_ACTOR = /^(human|agent:[^@]*)@/;

type Fields = Record<string, unknown>;

/** The most specific identifier the item already has: DOI, arXiv id, PMID, then ISBN. */
function identifierOf(fm: Fields): Identifier | undefined {
  const ids = (fm.ids ?? {}) as Record<string, string | undefined>;
  const candidates = [
    typeof fm.DOI === "string" ? fm.DOI : undefined,
    ids.arxiv ? `arXiv:${ids.arxiv}` : undefined,
    ids.pmid ? `PMID:${ids.pmid}` : undefined,
    typeof fm.ISBN === "string" ? fm.ISBN : undefined,
  ];
  for (const c of candidates) {
    const id = c ? detectIdentifier(c) : undefined;
    if (id) return id;
  }
  return undefined;
}

function firstCreator(fm: Fields): string | undefined {
  const first = (fm.author as Array<{ family?: string; literal?: string }> | undefined)?.[0];
  return first?.family ?? first?.literal;
}

async function lookup(
  resolver: MetadataLookup,
  citekey: string,
  fm: Fields,
): Promise<{ result: ResolveResult; id?: Identifier }> {
  const id = identifierOf(fm);
  if (id) return { result: await resolver.resolve(id), id };
  const title = typeof fm.title === "string" ? fm.title : undefined;
  if (!title) {
    throw problem(
      "ITEM_NOT_RESOLVABLE",
      `item ${citekey} has no DOI, arXiv id, PMID, ISBN or title to look up`,
      "Add one of them with items.update, then call items.resolve again.",
      { citekey },
    );
  }
  const author = firstCreator(fm);
  const year = fm.issued;
  let match: TitleResolveResult;
  try {
    match = await resolver.resolveByTitle({
      title,
      ...(author ? { firstAuthor: author } : {}),
      ...(typeof year === "number" ? { year } : {}),
    });
  } catch (err) {
    throw problem(
      "METADATA_UNAVAILABLE",
      `no metadata source answered for the title of ${citekey}: ${err instanceof Error ? err.message : String(err)}`,
      "Try again in a minute.",
      { citekey },
      "retry",
    );
  }
  if (match.match.verdict !== "accept" || match.resolved?.status !== "resolved") {
    throw problem(
      "ITEM_NOT_RESOLVABLE",
      `no confident match for the title of ${citekey} (${match.match.verdict})`,
      "Add a DOI, arXiv id or ISBN with items.update, then call items.resolve again.",
      { citekey },
    );
  }
  return { result: match.resolved };
}

const sameValue = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * items.resolve: looks the item up again and merges the answer. A field whose provenance names a
 * person or an agent, or a field that has a value but no provenance, was edited by hand and stays.
 * Everything else (earlier lookups, guesses from a file name or a page) is replaced when the new
 * value differs. The citekey, tags, projects, sources and status are never touched.
 */
export async function resolveItem(
  deps: { lib: Library; resolver: MetadataLookup },
  actor: Actor,
  citekey: string,
): Promise<{ citekey: string; changed: string[] }> {
  const { lib } = deps;
  const item = loadItem(lib, citekey);
  const old = item.fm as unknown as Fields;
  const { result, id } = await lookup(deps.resolver, citekey, old);

  if (result.status === "unsupported") {
    throw problem(
      "IDENTIFIER_UNSUPPORTED",
      `${id?.kind ?? "this"} identifiers cannot be resolved yet`,
      "Add a DOI, arXiv id or ISBN with items.update.",
      { citekey },
    );
  }
  if (result.status !== "resolved" || !result.fields.title) {
    const down = result.errors.length > 0;
    throw problem(
      down ? "METADATA_UNAVAILABLE" : "METADATA_NOT_FOUND",
      down
        ? `no metadata source answered for ${citekey}: ${result.errors.map((e) => `${e.source}: ${e.message}`).join("; ")}`
        : `no metadata found for ${citekey}`,
      down ? "Try again in a minute." : "Check the DOI or arXiv id of the item for typos.",
      { citekey },
      down ? "retry" : "fix-and-retry",
    );
  }

  const provenance = { ...item.fm.provenance } as Record<string, string>;
  const today = lib.stamp(actor).at.slice(0, 10);
  const patch: Fields = {};
  const changed: string[] = [];
  const { ids, ...fields } = result.fields;
  for (const [key, value] of Object.entries(fields)) {
    if (key === "tags" || value === undefined) continue;
    const prov = provenance[key];
    const hasValue = old[key] !== undefined;
    if (hasValue && (prov === undefined || EDITED_BY_ACTOR.test(prov))) continue;
    if (sameValue(old[key], value)) continue;
    patch[key] = value;
    provenance[key] = result.provenance[key] ?? `metadata@${today}`;
    changed.push(key);
  }
  const mergedIds = { ...(old.ids as object | undefined), ...(ids ?? {}) };
  if (!sameValue(old.ids ?? {}, mergedIds)) {
    patch.ids = mergedIds;
    changed.push("ids");
  }
  if (changed.length === 0) return { citekey, changed };

  // A lookup by identifier answers what an earlier first-page guess only proposed.
  if (id && old.proposal !== undefined) patch.proposal = undefined;
  patch.provenance = provenance;
  saveItem(lib, actor, item, patch);
  return { citekey, changed };
}
