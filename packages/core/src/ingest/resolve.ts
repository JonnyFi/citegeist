import {
  detectIdentifier,
  type Identifier,
  type ResolveResult,
  type TitleResolveResult,
} from "@citegeist/metadata";
import type { Actor } from "@citegeist/schema";
import { CitegeistError } from "@citegeist/schema";
import type { Library } from "../library.js";
import { findDuplicate } from "./dupes.js";
import { identifierTwinError, loadItem, problem, saveItem } from "./items.js";
import { suggestCitekey } from "./placeholder.js";
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
      "Pass a DOI, arXiv id or ISBN with items.add and the citekey of the item, or set a title with items.update.",
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
      "Pass a DOI, arXiv id or ISBN with items.add and the citekey of the item.",
      { citekey },
    );
  }
  return { result: match.resolved };
}

const sameValue = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** What a lookup brings: fields in item shape, the other identifiers, and where each field is from. */
export interface Lookup {
  fields: Fields;
  ids: Record<string, string>;
  provenance: Record<string, string>;
}

export interface MergeOptions {
  /**
   * The identifier the caller gave. It is stored as a field the caller set (provenance names the
   * actor), so that a later lookup keeps it.
   */
  identifier?: Identifier | undefined;
  /** The lookup came from an identifier: a first-page guess (`proposal`) is settled. */
  clearProposal?: boolean | undefined;
}

export interface MergeOutcome {
  changed: string[];
  /** The item had a placeholder citekey and now has what a real one needs. Nothing was renamed. */
  suggestedCitekey?: string;
}

/** Provenance that a guess left behind and a lookup may replace. */
const WEAK = /^(filename|pdf-text|grobid|web|html|ai-first-page)@/;

/**
 * Merges a lookup into an item. A field whose provenance names a person or an agent, or a field
 * that has a value but no provenance, was edited by hand and stays. Everything else (earlier
 * lookups, guesses from a file name or a page) is replaced when the new value differs. The
 * citekey, tags, projects, sources and status are never touched.
 */
export function mergeLookup(
  lib: Library,
  actor: Actor,
  citekey: string,
  lookup: Lookup,
  options: MergeOptions = {},
): MergeOutcome {
  const item = loadItem(lib, citekey);
  const old = item.fm as unknown as Fields;
  const provenance = { ...item.fm.provenance } as Record<string, string>;
  const today = lib.stamp(actor).at.slice(0, 10);
  const by = `${actor}@${today}`;
  const patch: Fields = {};
  const changed: string[] = [];

  for (const [key, value] of Object.entries(lookup.fields)) {
    if (key === "tags" || value === undefined) continue;
    // The type comes from the same guess as the title.
    const prov = key === "type" ? (provenance.type ?? provenance.title) : provenance[key];
    const hasValue = old[key] !== undefined;
    if (hasValue && (prov === undefined || EDITED_BY_ACTOR.test(prov))) continue;
    if (sameValue(old[key], value)) continue;
    patch[key] = value;
    provenance[key] = lookup.provenance[key] ?? `metadata@${today}`;
    changed.push(key);
  }

  // The host a web page guess put into the container title says nothing about a work that turned
  // out to be a journal article or a book.
  const containerProv = provenance["container-title"];
  if (
    patch["container-title"] === undefined &&
    old["container-title"] !== undefined &&
    (patch.type ?? old.type) !== "webpage" &&
    old.type === "webpage" &&
    containerProv !== undefined &&
    WEAK.test(containerProv)
  ) {
    patch["container-title"] = undefined;
    delete provenance["container-title"];
    changed.push("container-title");
  }

  const mergedIds = { ...(old.ids as object | undefined), ...lookup.ids };
  const given = options.identifier;
  if (given) {
    // The identifier the caller gave belongs to the item, whatever the lookup returned for it.
    const value =
      given.kind === "doi"
        ? given.value
        : given.kind === "isbn"
          ? ((lookup.fields.ISBN as string | undefined) ?? given.value)
          : given.kind === "url"
            ? given.value
            : undefined;
    const field =
      given.kind === "doi"
        ? "DOI"
        : given.kind === "isbn"
          ? "ISBN"
          : given.kind === "url"
            ? "URL"
            : undefined;
    if (field && value !== undefined) {
      if (!sameValue(old[field], value)) {
        patch[field] = value;
        if (!changed.includes(field)) changed.push(field);
      }
      provenance[field] = by;
    }
    if (given.kind === "arxiv") (mergedIds as Record<string, string>).arxiv = given.value;
    if (given.kind === "pmid") (mergedIds as Record<string, string>).pmid = given.value;
  }
  if (!sameValue(old.ids ?? {}, mergedIds)) {
    patch.ids = mergedIds;
    changed.push("ids");
  }
  if (changed.length === 0 && patch.ids === undefined) return { changed };

  // A lookup by identifier answers what an earlier first-page guess only proposed.
  if (old.proposal !== undefined && options.clearProposal) patch.proposal = undefined;
  patch.provenance = provenance;
  saveItem(lib, actor, item, patch);
  const suggestedCitekey = suggestCitekey(lib, item.fm, loadItem(lib, citekey).fm);
  return { changed, ...(suggestedCitekey ? { suggestedCitekey } : {}) };
}

/** Keys of an item that describe the work. The others belong to the item itself. */
const OWN_KEYS = new Set([
  "id",
  "citekey",
  "created",
  "modified",
  "sources",
  "tags",
  "projects",
  "status",
  "inbox",
  "incomplete",
  "fulltext",
  "proposal",
  "provenance",
  "ids",
  "ai_language",
]);

/**
 * What `into` takes from `from` when the two are the same work (items.merge). A field the target
 * lacks is filled. A field the target has stays, unless its provenance names a guess (a file
 * name, a page, a first page) and the other item has it from a better source. Fields that a
 * person or an agent edited, or that have no provenance, never change. Returns the patch for the
 * target, with its provenance and ids, and the names of the changed fields.
 */
export function fillFromTwin(
  into: Fields,
  from: Fields,
  today: string,
): { patch: Fields; changed: string[] } {
  const intoProv = { ...((into.provenance ?? {}) as Record<string, string>) };
  const fromProv = (from.provenance ?? {}) as Record<string, string>;
  const patch: Fields = {};
  const changed: string[] = [];
  for (const [key, value] of Object.entries(from)) {
    if (OWN_KEYS.has(key) || value === undefined) continue;
    const prov = key === "type" ? (intoProv.type ?? intoProv.title) : intoProv[key];
    const theirs = key === "type" ? (fromProv.type ?? fromProv.title) : fromProv[key];
    if (into[key] !== undefined) {
      const guess = prov !== undefined && WEAK.test(prov);
      const better = theirs !== undefined && !WEAK.test(theirs);
      if (!guess || !better || sameValue(into[key], value)) continue;
    }
    patch[key] = value;
    intoProv[key] = theirs ?? `merge@${today}`;
    changed.push(key);
  }
  const ids = { ...((from.ids ?? {}) as object), ...((into.ids ?? {}) as object) };
  if (!sameValue(into.ids ?? {}, ids)) {
    patch.ids = ids;
    changed.push("ids");
  }
  if (changed.length > 0) patch.provenance = intoProv;
  return { patch, changed };
}

/** A resolver answer in the shape of a lookup. Throws the error for an answer that has no title. */
function lookupFrom(result: ResolveResult, citekey: string, id: Identifier | undefined): Lookup {
  if (result.status === "unsupported") {
    throw problem(
      "IDENTIFIER_UNSUPPORTED",
      `${id?.kind ?? "this"} identifiers cannot be resolved yet`,
      "Pass a DOI, arXiv id or ISBN with items.add and the citekey of the item.",
      { citekey },
    );
  }
  if (result.status !== "resolved" || !result.fields.title) {
    const down = result.errors.length > 0;
    throw problem(
      down ? "METADATA_UNAVAILABLE" : "METADATA_NOT_FOUND",
      down
        ? `no metadata source answered for ${citekey}: ${result.errors.map((e) => `${e.source}: ${e.message}`).join("; ")}`
        : `no metadata found for ${id ? id.raw : citekey}`,
      down
        ? "Try again in a minute."
        : "Check the identifier for typos, or pass another one (DOI, arXiv id, ISBN) with items.add and the citekey of the item.",
      { citekey },
      down ? "retry" : "fix-and-retry",
    );
  }
  const { ids, ...fields } = result.fields;
  return { fields, ids: ids ?? {}, provenance: result.provenance };
}

export interface ResolveDeps {
  lib: Library;
  resolver: MetadataLookup;
  /** Reads a web page the way items.add does. Without it, plain URLs cannot be resolved. */
  fromUrl?: (actor: Actor, url: string) => Promise<Lookup>;
  /**
   * Reads the page at the address of an item again, metadata only. Undefined when the page has
   * nothing to merge; throws when it is a bot check or cannot be reached.
   */
  refetchUrl?: (
    actor: Actor,
    url: string,
  ) => Promise<{ lookup: Lookup; viaIdentifier: boolean } | undefined>;
}

/**
 * An item that has an address but no DOI, arXiv id, PMID or ISBN is read from its page again
 * (JSON-LD, citation tags and the like), so that a web source is looked up by what it says and
 * not by a guess from its title. An identifier the address itself carries (SSRN, doi.org) is
 * tried through the sources first. Undefined means the page gave nothing: match by title.
 */
async function lookupFromAddress(
  deps: ResolveDeps,
  actor: Actor,
  citekey: string,
  fm: Fields,
): Promise<{ found: Lookup; byIdentifier: boolean } | { unreachable: CitegeistError } | undefined> {
  const url = typeof fm.URL === "string" ? fm.URL.trim() : "";
  if (!url || !deps.refetchUrl || identifierOf(fm)) return undefined;
  const id = detectIdentifier(url);
  if (!id) return undefined;
  if (id.kind !== "url") {
    try {
      const res = await deps.resolver.resolve(id);
      if (res.status === "resolved" && res.fields.title) {
        return { found: lookupFrom(res, citekey, id), byIdentifier: true };
      }
    } catch {
      // the page itself may still say what the work is
    }
  }
  let page: Awaited<ReturnType<NonNullable<ResolveDeps["refetchUrl"]>>>;
  try {
    page = await deps.refetchUrl(actor, url);
  } catch (err) {
    // A dead address must not block the title match that resolved such items before.
    if (err instanceof CitegeistError && err.detail.code === "URL_UNREACHABLE") {
      return { unreachable: err };
    }
    throw err;
  }
  return page ? { found: page.lookup, byIdentifier: page.viaIdentifier } : undefined;
}

/** Throws when another item already has an identifier the lookup brought. */
function refuseTwin(lib: Library, actor: Actor, citekey: string, found: Lookup): void {
  const doi = found.fields.DOI;
  const isbn = found.fields.ISBN;
  const twin = findDuplicate(lib, {
    doi: typeof doi === "string" ? doi : undefined,
    isbn: typeof isbn === "string" ? isbn : undefined,
    arxiv: found.ids.arxiv,
    pmid: found.ids.pmid,
    except: citekey,
  });
  if (!twin) return;
  const err = identifierTwinError(
    lib,
    actor,
    citekey,
    twin,
    `the page of ${citekey} names an identifier that`,
  );
  if (err.detail.code === "IDENTIFIER_IN_INBOX") throw err;
  throw problem(
    "IDENTIFIER_IN_USE",
    `the page of ${citekey} names an identifier that already belongs to the item ${twin}`,
    `Both items are the same work. Keep one: trash ${citekey} with items.trash (an agent may trash its own and incomplete items), or ask the user to remove the one they do not want.`,
    { citekey, duplicateOf: twin },
    "ask-human",
  );
}

/**
 * items.resolve: looks the item up again and merges the answer (see `mergeLookup`). With
 * `identifier` (a DOI, ISBN, arXiv id, PMID or a URL) the item gets that identifier first: the
 * lookup runs with it, and it is stored together with the answer. A lookup that fails stores
 * nothing, so that a typo does not stay in the item.
 */
export async function resolveItem(
  deps: ResolveDeps,
  actor: Actor,
  citekey: string,
  identifier?: string,
): Promise<{ citekey: string; changed: string[]; suggestedCitekey?: string }> {
  const { lib } = deps;
  const item = loadItem(lib, citekey);
  const old = item.fm as unknown as Fields;

  let found: Lookup;
  let given: Identifier | undefined;
  let byIdentifier = false;
  if (identifier !== undefined && identifier.trim() !== "") {
    given = detectIdentifier(identifier.trim());
    if (!given) {
      throw problem(
        "INVALID_IDENTIFIER",
        `'${identifier.trim().slice(0, 80)}' is not a DOI, arXiv id, ISBN, PMID or URL`,
        "Pass a DOI like 10.1038/s41586-020-2649-2, an arXiv id like 1706.03762, an ISBN, a PMID or a URL.",
        { citekey },
      );
    }
    if (given.kind === "url") {
      if (!deps.fromUrl) {
        throw problem(
          "IDENTIFIER_UNSUPPORTED",
          "this core cannot read web pages",
          "Pass a DOI, arXiv id or ISBN.",
          { citekey },
        );
      }
      found = await deps.fromUrl(actor, given.value);
    } else {
      found = lookupFrom(await deps.resolver.resolve(given), citekey, given);
    }
    const doi =
      (found.fields.DOI as string | undefined) ?? (given.kind === "doi" ? given.value : undefined);
    const twin = findDuplicate(lib, {
      doi,
      isbn: given.kind === "isbn" ? given.value : (found.fields.ISBN as string | undefined),
      arxiv: given.kind === "arxiv" ? given.value : found.ids.arxiv,
      pmid: given.kind === "pmid" ? given.value : found.ids.pmid,
      url: given.kind === "url" ? given.value : undefined,
      except: citekey,
    });
    if (twin) throw identifierTwinError(lib, actor, citekey, twin, given.raw.slice(0, 80));
  } else {
    given = undefined;
    const web = await lookupFromAddress(deps, actor, citekey, old);
    if (web && "found" in web) {
      refuseTwin(lib, actor, citekey, web.found);
      found = web.found;
      byIdentifier = web.byIdentifier;
    } else {
      let looked: Awaited<ReturnType<typeof lookup>>;
      try {
        looked = await lookup(deps.resolver, citekey, old);
      } catch (err) {
        // The title match failed too; the dead address is the more useful message.
        if (web && "unreachable" in web) throw web.unreachable;
        throw err;
      }
      found = lookupFrom(looked.result, citekey, looked.id);
      byIdentifier = looked.id !== undefined;
    }
  }

  const merged = mergeLookup(lib, actor, citekey, found, {
    identifier: given,
    // A lookup by identifier answers what an earlier first-page guess only proposed.
    clearProposal: byIdentifier || (given !== undefined && given.kind !== "url"),
  });
  return { citekey, ...merged };
}
