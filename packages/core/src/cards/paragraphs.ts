import { locate, normalizeText, resolveAnchor, type TextAnchorRecord } from "@citegeist/anchoring";
import {
  type CardFrontmatter,
  type ItemFrontmatter,
  type Locator,
  paragraphLocator,
} from "@citegeist/schema";
import type { Library } from "../library.js";
import type { DerivedStore } from "./derived.js";

/** Ids of the blocks a text anchor covers, in reading order. Empty if the anchor cannot be placed. */
export function blocksOfAnchor(
  derived: DerivedStore,
  citekey: string,
  source: string,
  anchor: Pick<TextAnchorRecord, "exact"> & Partial<TextAnchorRecord>,
): string[] {
  const doc = derived.blocks(citekey, source);
  if (!doc) return [];
  const exact = normalizeText(anchor.exact);
  // fast path: the block hint holds the whole passage
  const hinted = anchor.block ? doc.blocks.find((b) => b.id === anchor.block) : undefined;
  if (hinted && normalizeText(hinted.text).includes(exact)) return [hinted.id];
  const r = resolveAnchor(doc.stream, {
    exact,
    prefix: anchor.prefix ?? "",
    suffix: anchor.suffix ?? "",
    start: anchor.start,
    end: anchor.end,
    block: anchor.block,
  });
  if (r.status !== "anchored") return hinted ? [hinted.id] : [];
  return locate(doc.stream, r.start, r.end).blocks.map((b) => b.id);
}

/** The source a card belongs to: its `source` field, else the one a new card would pick. */
function sourceOfCard(
  derived: DerivedStore,
  item: ItemFrontmatter,
  fm: CardFrontmatter,
): ItemFrontmatter["sources"][number] | undefined {
  if (fm.source) return item.sources.find((s) => s.hash === fm.source);
  const converted = item.sources.filter((s) => derived.hasBlocks(item.citekey, s.hash));
  return converted.find((s) => s.role === "main") ?? converted[0] ?? item.sources[0];
}

/** A locator that says nothing new: what a card of a web page got when its single page was labelled 1. */
function isPlaceholderLocator(loc: Locator | undefined): boolean {
  return loc === undefined || (loc.label === "page" && loc.start === "1" && loc.end === undefined);
}

/**
 * Cards of an unpaginated source cite a paragraph. Older cards of such a source have no locator or
 * the page 1 of the single placeholder page; this returns them with the paragraph derived from
 * their text anchor. Nothing is written: the file changes only when the card is saved. A card with
 * any other locator, a PDF anchor or a paginated source comes back as it is (same object).
 */
export function withParagraphLocator(lib: Library, fm: CardFrontmatter): CardFrontmatter {
  if (!isPlaceholderLocator(fm.locator) || fm.anchor.pdf || !fm.anchor.text) return fm;
  const item = lib.getItemFrontmatter(fm.item);
  if (!item) return fm;
  const source = sourceOfCard(lib.derived, item, fm);
  if (!source || !lib.derived.isUnpaginated(item.citekey, source)) return fm;
  const numbers = lib.derived.paragraphs(item.citekey, source.hash);
  if (!numbers) return fm;
  const ids = blocksOfAnchor(lib.derived, item.citekey, source.hash, fm.anchor.text);
  const locator = paragraphLocator(numbers, ids);
  return locator ? { ...fm, locator } : fm;
}
