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
