import type { Creator } from "@citegeist/schema";
import type { Translator } from "../i18n";

export function creatorName(c: Creator): string {
  if ("literal" in c) return c.literal;
  return c.given ? `${c.family}, ${c.given}` : c.family;
}

/** Item type in the UI language; unknown CSL types fall back to their id without hyphens. */
export function typeLabel({ t, has }: Translator, type: string): string {
  const key = `type.${type}`;
  return has(key) ? t(key) : type.replace(/-/g, " ");
}

export function statusLabel({ t, has }: Translator, status: string): string {
  const key = `status.${status}`;
  return has(key) ? t(key) : status;
}

/** "S. 31" or "S. 31-32" for a card; the label is a CSL locator term such as "page". */
export function locatorText(
  { t, has }: Translator,
  locator: { label: string; start: string; end?: string | undefined } | undefined,
): string | undefined {
  if (!locator) return undefined;
  const key = `locator.${locator.label}`;
  const term = has(key) ? t(key) : locator.label;
  return `${term} ${locator.start}${locator.end ? `-${locator.end}` : ""}`;
}

/** A locator term at the end of a label: "S. 8", "p. 31-32", "pp. 3, 5", "Abs. 4", "para. 4". */
const TRAILING_LOCATOR =
  /,?\s*(?:S\.|pp?\.|Abs\.|paras?\.|Kap\.|ch\.|Abschn\.|secs?\.)\s*\d[\d\s,\u2013-]*$/;

/**
 * A label an agent wrote for a card ("Srnicek 2013, S. 8") with its closing locator replaced by
 * the one the card has, so a paragraph card reads "Abs. 8" and not "S. 8". A label without a
 * locator, or a card without one, stays as it is.
 */
export function withCardLocator(
  tr: Translator,
  label: string,
  locator: { label: string; start: string; end?: string | undefined } | undefined,
): string {
  const where = locatorText(tr, locator);
  if (!where || !TRAILING_LOCATOR.test(label)) return label;
  return `${label.replace(TRAILING_LOCATOR, "")}, ${where}`;
}

/**
 * A calendar date such as "2026-10-26" in the UI language ("26.10.2026" in German). It is read
 * as a local date: a date without a time must not move to the day before in a zone behind UTC.
 */
export function formatDay(day: string, lang: string): string {
  const [y, m, d] = day.split("-").map(Number);
  if (!y || !m || !d) return "";
  return new Date(y, m - 1, d).toLocaleDateString(lang, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}
