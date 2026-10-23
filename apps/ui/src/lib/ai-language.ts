import type { ItemFrontmatter } from "@citegeist/schema";

/** Library default of the AI language. The core keeps it in citegeist.json (`defaults.ai_language`). */
export const LIBRARY_AI_LANGUAGE = "de";

/** Languages the AI texts can be written in. */
export const AI_LANGUAGES = ["de", "en", "fr", "es", "it"] as const;

export type LanguageOrigin = "item" | "project" | "library";

export interface EffectiveLanguage {
  value: string;
  origin: LanguageOrigin;
}

/**
 * D9: the language of AI texts for one source is the item's own setting, else the first of its
 * projects that sets one, else the library default.
 */
export function effectiveAiLanguage(
  item: Pick<ItemFrontmatter, "ai_language" | "projects">,
  projectLanguages: ReadonlyMap<string, string | undefined>,
): EffectiveLanguage {
  if (item.ai_language) return { value: item.ai_language, origin: "item" };
  for (const slug of item.projects) {
    const lang = projectLanguages.get(slug);
    if (lang) return { value: lang, origin: "project" };
  }
  return { value: LIBRARY_AI_LANGUAGE, origin: "library" };
}
