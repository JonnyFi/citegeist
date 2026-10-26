import { cardsExport, citeFormat } from "@citegeist/ops";
import type { Core } from "./core";

/**
 * The three ways to put a source into a text, shared by the card buttons, the `@` menu in the
 * texts editor and the quick-insert palette:
 * - direct: the quote and its citation
 * - indirect: the paraphrase and its citation with the prefix "vgl." (German) or none (English)
 * - cite: the citation alone
 */
export type CitationKind = "direct" | "indirect" | "cite";

export const CITATION_KINDS: readonly CitationKind[] = ["direct", "indirect", "cite"];

/** What a person picked: a quote card or a whole source (a source only has a citation). */
export type CitationSubject = { type: "card"; id: string } | { type: "source"; citekey: string };

/**
 * Where the citation goes. Inside the texts editor it is Pandoc syntax (`[@key, S. 12]`, the
 * terms of the text's language), so the export renders the style of the text. Anywhere else it is
 * formatted text and rich text in the style of the project.
 */
export type CitationTarget =
  | { type: "text"; project: string; lang?: string | undefined }
  | { type: "external"; project?: string | undefined };

export interface RenderedCitation {
  text: string;
  html?: string | undefined;
}

/** Keys of the quick-insert palette and the `@` menu: Enter, Shift+Enter, Alt+Enter. Alt wins. */
export function kindForKeys(keys: { shiftKey?: boolean; altKey?: boolean }): CitationKind {
  if (keys.altKey) return "cite";
  return keys.shiftKey ? "indirect" : "direct";
}

/** A source has no quote and no paraphrase, so it can only be cited. */
export function kindFor(subject: CitationSubject, kind: CitationKind): CitationKind {
  return subject.type === "source" ? "cite" : kind;
}

/** The citation as the target needs it. The one place that turns a choice into text. */
export async function renderCitation(
  core: Core,
  subject: CitationSubject,
  kind: CitationKind,
  target: CitationTarget,
): Promise<RenderedCitation> {
  const pandoc = target.type === "text";
  const project = target.project ? { project: target.project } : {};
  const locale = target.type === "text" && target.lang ? { locale: target.lang } : {};
  if (subject.type === "card") {
    const out = await core.call(cardsExport, {
      ids: [subject.id],
      mode: kind,
      format: pandoc ? "pandoc" : "html",
      ...project,
      ...locale,
    });
    return { text: out.text, html: out.html };
  }
  const out = await core.call(citeFormat, {
    items: [{ citekey: subject.citekey }],
    mode: "citation",
    format: pandoc ? "pandoc" : "html",
    ...project,
    ...locale,
  });
  return { text: out.text, html: out.html };
}
