import { CitegeistError } from "@citegeist/schema";

type Recovery = "retry" | "fix-and-retry" | "do-first" | "ask-human";

function make(
  code: string,
  recovery: Recovery,
  message: string,
  fix: string,
  context: Record<string, unknown> = {},
): CitegeistError {
  return new CitegeistError({ code, message, fix, recovery, sideEffects: "none", context });
}

export const cardErrors = {
  notFound: (id: string) =>
    make(
      "CARD_NOT_FOUND",
      "fix-and-retry",
      `no card with id '${id}'`,
      "Call cards.list to find the right card id.",
      { id },
    ),
  quoteImmutable: (id: string) =>
    make(
      "CARD_QUOTE_IMMUTABLE",
      "fix-and-retry",
      `the quote of card '${id}' can never be changed`,
      "Remove 'quote' from the patch. Create a new card with cards.create for a different passage.",
      { id },
    ),
  invalidPatch: (id: string, message: string, fix: string) =>
    make("INVALID_PATCH", "fix-and-retry", message, fix, { id }),
  invalidAnchor: (message: string, fix: string, context: Record<string, unknown> = {}) =>
    make("INVALID_ANCHOR", "fix-and-retry", message, fix, context),
  anchorNotFound: (citekey: string, source: string) =>
    make(
      "ANCHOR_NOT_FOUND",
      "fix-and-retry",
      `the selected text was not found in the converted document of '${citekey}' (source ${source})`,
      "Check that the anchor refers to the right source, or add a PDF anchor with page and quads.",
      { citekey, source },
    ),
  sourceNotFound: (citekey: string, source: string) =>
    make(
      "SOURCE_NOT_FOUND",
      "fix-and-retry",
      `item '${citekey}' has no source '${source}'`,
      "Use items.get to list the sources of the item and pass one of their hashes.",
      { citekey, source },
    ),
  pagesMissing: (citekey: string, source: string) =>
    make(
      "PAGES_NOT_FOUND",
      "do-first",
      `no pages.json for source ${source} of '${citekey}'`,
      "Convert the document first with documents.convert.",
      { citekey, source },
    ),
  invalidPages: (message: string, fix: string, context: Record<string, unknown> = {}) =>
    make("INVALID_PAGES", "fix-and-retry", message, fix, context),
};
