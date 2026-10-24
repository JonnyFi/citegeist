import { existsSync } from "node:fs";
import type { AiRouter } from "@citegeist/ai";
import { generateCitekey } from "@citegeist/cite";
import {
  extractIdentifiers,
  pickPrimary,
  type TitleQuery,
  type TitleResolveResult,
} from "@citegeist/metadata";
import type { Actor, ItemFrontmatter, Source } from "@citegeist/schema";
import type { Library } from "../library.js";
import { isCited, loadItem, renameItem, saveItem } from "./items.js";
import { guessHeader, type HeaderGuess, type PdfTextExtractor } from "./pdf-text.js";
import type { MetadataLookup } from "./service.js";

export interface EnrichDeps {
  lib: Library;
  resolver: MetadataLookup;
  pdfText: PdfTextExtractor;
  /** Optional: reads title, author and year from the first page with the AI task. */
  ai?: Pick<AiRouter, "run"> | undefined;
}

export interface EnrichResult {
  /** "resolved": a metadata source confirmed the work. "proposal": read from the page, to review. */
  applied: "resolved" | "proposal" | "none";
  /** Set when the placeholder citekey was replaced. */
  renamed?: { from: string; to: string };
}

/** Provenance prefixes of values that came from a guess and may be replaced by better data. */
const WEAK_PROVENANCE = /^(filename|pdf-text|web|html|ai-first-page)@/;

export function splitName(name: string): { family: string; given?: string } {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return { family: parts[0] ?? name };
  const family = parts[parts.length - 1] ?? name;
  return { family, given: parts.slice(0, -1).join(" ") };
}

type Fm = ItemFrontmatter & Record<string, unknown>;

function overwritable(fm: Fm, key: string): boolean {
  // The type comes from the same guess as the title.
  if (key === "type") return overwritable(fm, "title");
  const prov = fm.provenance[key];
  if (prov === undefined) return fm[key] === undefined;
  return WEAK_PROVENANCE.test(prov);
}

function hasCreators(fm: Fm): boolean {
  return (fm.author?.length ?? 0) > 0 || (fm.editor?.length ?? 0) > 0;
}

/**
 * True when the metadata of an item is a guess that a first-page read can improve: the item
 * failed before, or it carries a review marker from somewhere other than the first page, or it
 * is an untyped document without an author.
 */
export function isWeakMetadata(fm: Fm, wasIncomplete: boolean): boolean {
  if (fm.DOI || fm.ISBN) return false;
  if (wasIncomplete) return true;
  const proposal = fm.proposal as { status?: string; source?: string } | undefined;
  // The add step already tried the first page for these.
  if (proposal?.source === "pdf-first-page") return false;
  if (proposal) return true;
  return !hasCreators(fm) && (fm.type === "webpage" || fm.type === "document");
}

/** A citekey that was made from missing data: no author or no year when it was generated. */
export function isPlaceholderKey(fm: Fm, formula: string): boolean {
  if (hasCreators(fm) && fm.issued !== undefined) return false;
  const base = generateCitekey(keySource(fm), new Set(), formula);
  return fm.citekey.startsWith(base);
}

function keySource(fm: Record<string, unknown>) {
  return {
    title: String(fm.title),
    ...(fm.author ? { author: fm.author as never } : {}),
    ...(fm.editor ? { editor: fm.editor as never } : {}),
    ...(fm.issued !== undefined ? { issued: fm.issued as never } : {}),
  };
}

async function headerFromAi(
  ai: Pick<AiRouter, "run">,
  text: string,
  filename: string,
): Promise<HeaderGuess | undefined> {
  try {
    const { output } = await ai.run("metadata.fromFirstPage", { text, filename });
    const title = output.title;
    if (!title || title.confidence === "low") return undefined;
    const author = output.author?.value[0];
    const year = output.issued ? Number(output.issued.value.slice(0, 4)) : undefined;
    const type = output.type?.value;
    return {
      title: title.value,
      ...(author ? { firstAuthor: `${author.given} ${author.family}`.trim() } : {}),
      ...(year && Number.isFinite(year) ? { year } : {}),
      ...(type === "article-journal" || type === "book" || type === "thesis" ? { type } : {}),
    };
  } catch {
    return undefined;
  }
}

/**
 * Runs after a conversion succeeded. When the item's metadata is a guess, it reads the first page
 * of the PDF (identifiers, then the AI task or the header heuristic, then title matching) and
 * replaces the guess. Values a person or a metadata source set are never touched. A placeholder
 * citekey is replaced only when nothing refers to the item yet.
 */
export async function enrichAfterConvert(
  deps: EnrichDeps,
  actor: Actor,
  citekey: string,
  source: Source,
  sourcePath: string,
  wasIncomplete: boolean,
): Promise<EnrichResult> {
  const { lib } = deps;
  if (source.kind !== "pdf") return { applied: "none" };
  const before = loadItem(lib, citekey);
  const old = before.fm as Fm;
  if (!isWeakMetadata(old, wasIncomplete)) return { applied: "none" };

  const text = await deps.pdfText(sourcePath);
  if (!text.firstPage && !text.leading) return { applied: "none" };
  const today = lib.stamp(actor).at.slice(0, 10);

  let resolved:
    | { fields: Record<string, unknown>; provenance: Record<string, string>; ids: object }
    | undefined;
  let header: HeaderGuess | undefined;
  let headerBy = "pdf-text";
  let reason = "";
  let candidates: unknown[] = [];

  const found = pickPrimary(extractIdentifiers(text.leading));
  if (found) {
    try {
      const res = await deps.resolver.resolve(found);
      if (res.status === "resolved" && res.fields.title) {
        const { ids, ...fields } = res.fields;
        resolved = { fields, provenance: res.provenance, ids: ids ?? {} };
      }
    } catch {
      // fall through to the page header
    }
  }
  if (!resolved) {
    if (deps.ai) header = await headerFromAi(deps.ai, text.firstPage, source.filename);
    if (header) headerBy = "ai-first-page";
    header ??= guessHeader(text.firstPage);
    if (header) {
      const query: TitleQuery = {
        title: header.title,
        ...(header.firstAuthor ? { firstAuthor: header.firstAuthor } : {}),
        ...(header.year !== undefined ? { year: header.year } : {}),
        ...(header.type ? { type: header.type } : {}),
      };
      let match: TitleResolveResult | undefined;
      try {
        match = await deps.resolver.resolveByTitle(query);
      } catch {
        match = undefined;
      }
      if (match?.match.verdict === "accept" && match.resolved?.status === "resolved") {
        if (match.resolved.fields.title) {
          const { ids, ...fields } = match.resolved.fields;
          resolved = { fields, provenance: match.resolved.provenance, ids: ids ?? {} };
        }
      } else {
        reason = match
          ? `title matching gave '${match.match.verdict}', no confident match`
          : "title matching was not possible (metadata sources unreachable)";
        candidates = (match?.match.scored ?? []).slice(0, 3).map((s) => ({
          title: s.candidate.title ?? null,
          DOI: s.candidate.DOI ?? null,
          similarity: Number(s.titleSimilarity.toFixed(2)),
        }));
      }
    }
  }
  if (!resolved && !header) return { applied: "none" };

  const provenance: Record<string, string> = { ...old.provenance };
  const patch: Record<string, unknown> = {};
  const set = (key: string, value: unknown, prov: string): void => {
    if (value === undefined || !overwritable(old, key)) return;
    patch[key] = value;
    provenance[key] = prov;
  };

  if (resolved) {
    for (const [key, value] of Object.entries(resolved.fields)) {
      if (key === "tags") continue;
      set(key, value, resolved.provenance[key] ?? `metadata@${today}`);
    }
    patch.ids = { ...old.ids, ...resolved.ids };
    patch.proposal = undefined;
  } else if (header) {
    const prov = `${headerBy}@${today}`;
    const author = header.firstAuthor ? splitName(header.firstAuthor) : undefined;
    set("title", header.title, prov);
    if (author) set("author", [author], prov);
    if (header.year !== undefined) set("issued", header.year, prov);
    set("type", header.type ?? "document", prov);
    patch.proposal = {
      status: "needs-review",
      source: "pdf-first-page",
      reason,
      candidates,
    };
  }
  // The host a web page guess put into the container title is no information about the work.
  if (old["container-title"] !== undefined && patch["container-title"] === undefined) {
    const prov = old.provenance["container-title"];
    if (old.type === "webpage" && prov !== undefined && WEAK_PROVENANCE.test(prov)) {
      patch["container-title"] = undefined;
      delete provenance["container-title"];
    }
  }
  patch.incomplete = undefined;
  patch.provenance = provenance;
  saveItem(lib, actor, before, patch);

  // A placeholder key (made from a missing author or year) gives way to the real one, as long
  // as nothing cites the item yet.
  const formula = lib.manifest.defaults.citekey;
  const result: EnrichResult = { applied: resolved ? "resolved" : "proposal" };
  if (isPlaceholderKey(old, formula) && !isCited(lib, citekey)) {
    const existing = new Set(
      lib.index.all<{ citekey: string }>("SELECT citekey FROM items").map((r) => r.citekey),
    );
    existing.delete(citekey);
    const now = loadItem(lib, citekey).fm;
    const next = generateCitekey(keySource(now), existing, formula);
    if (next !== citekey && !existsSync(lib.paths.itemDir(next))) {
      renameItem(lib, actor, citekey, next);
      result.renamed = { from: citekey, to: next };
    }
  }
  return result;
}
