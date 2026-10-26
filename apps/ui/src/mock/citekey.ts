import type { ItemFrontmatter } from "@citegeist/schema";

/**
 * The citekey the real core would offer once a placeholder key (anon..., nd...) has author and
 * year. The mock builds it from family name, year and the first word of the title.
 */
export function suggestMockCitekey(
  before: ItemFrontmatter,
  after: ItemFrontmatter,
  items: Map<string, unknown>,
): string | undefined {
  const placeholder = before.citekey.startsWith("anon") || before.issued === undefined;
  const first = after.author?.[0] ?? after.editor?.[0];
  if (!placeholder || !first || after.issued === undefined) return undefined;
  const family = ("family" in first ? first.family : first.literal)
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  const word =
    after.title
      .toLowerCase()
      .split(/[^a-z]+/)
      .find((w) => w.length > 3) ?? "";
  const base = `${family}${String(after.issued).slice(0, 4)}${word}`;
  let key = base;
  for (let n = 2; items.has(key) && key !== after.citekey; n++) key = `${base}${n}`;
  return key === after.citekey ? undefined : key;
}
