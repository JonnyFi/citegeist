import { Locator } from "./card.js";
import type { Block, DerivedManifest, Pages } from "./document.js";

/**
 * Sources without printed pages and without PDF pages cite a paragraph instead of a page
 * (docs/spec/library-format.md, "Unpaginated sources").
 */

/** Manifest flags the worker sets when a conversion has no page structure. */
const UNPAGINATED_FLAGS = ["no-pages", "no-pdf-for-page-mapping"];

/** Block types that count as a paragraph: running text, list items and block quotes. */
const PARAGRAPH_TYPES = new Set<Block["type"]>(["paragraph", "list-item", "quote"]);

/** What decides whether a source has pages: its kind, the manifest and pages.json of its conversion. */
export interface PaginationInput {
  /** `Source.kind` of the item source. */
  kind?: string | undefined;
  manifest?: Pick<DerivedManifest, "path" | "flags"> | undefined;
  pages?: Pick<Pages, "pages"> | undefined;
}

/**
 * True when a source has neither printed page labels nor PDF pages: a web page, an HTML file, an
 * EPUB, or arXiv HTML converted without its PDF. Such a source is cited by paragraph.
 */
export function isUnpaginated(source: PaginationInput): boolean {
  if (source.kind === "pdf") return false;
  const { manifest, pages } = source;
  if (manifest) {
    if (manifest.path === "web") return true;
    if (manifest.flags.some((f) => UNPAGINATED_FLAGS.includes(f))) return true;
    if (manifest.path === "digital" || manifest.path === "scan") return false;
  }
  if (source.kind === "web" || source.kind === "html" || source.kind === "epub") return true;
  if (pages) {
    // arXiv HTML without a PDF has one placeholder page of HTML text and no label
    return pages.pages.length <= 1 && pages.pages.every((p) => p.textSource === "html" && !p.label);
  }
  return source.kind === "arxiv-html";
}

/** True for a block that counts as a paragraph: body text, not a heading, table, figure or note. */
export function isParagraphBlock(block: Pick<Block, "type" | "flow">): boolean {
  return block.flow === "body" && PARAGRAPH_TYPES.has(block.type);
}

/**
 * Paragraph number of every text block of a document, counted from 1 in reading order. Headings,
 * titles, tables, figures, captions, equations, code, footnotes, references and page furniture are
 * not counted and have no entry.
 */
export function paragraphNumbers(
  blocks: readonly Pick<Block, "id" | "type" | "flow">[],
): Map<string, number> {
  const out = new Map<string, number>();
  let n = 0;
  for (const b of blocks) {
    if (isParagraphBlock(b)) out.set(b.id, ++n);
  }
  return out;
}

/**
 * Locator of the paragraphs a passage covers: the number of the first and last counted block of
 * `blockIds`, as `{label: "paragraph", start, end?}`. Undefined when none of the blocks is a paragraph.
 * A paragraph number is derived from the document, so it counts as confirmed.
 */
export function paragraphLocator(
  numbers: ReadonlyMap<string, number>,
  blockIds: readonly string[],
): Locator | undefined {
  const hits = blockIds.flatMap((id) => {
    const n = numbers.get(id);
    return n === undefined ? [] : [n];
  });
  if (hits.length === 0) return undefined;
  const start = Math.min(...hits);
  const end = Math.max(...hits);
  return Locator.parse({
    label: "paragraph",
    start: String(start),
    ...(end > start ? { end: String(end) } : {}),
    confirmed: true,
  });
}
