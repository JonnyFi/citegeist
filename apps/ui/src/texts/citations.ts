import { type CitationProvider, type CitationSuggestion, filterCitations } from "@citegeist/editor";
import { itemsList } from "@citegeist/ops";
import { useMemo } from "react";
import { useOp } from "../lib/hooks";
import { useLibraryLinks } from "../notes/library-links";

interface Source {
  citekey: string;
  title: string;
  authors?: string | undefined;
  year?: string | undefined;
}

/**
 * Autocomplete and checks for `[@citekey]` over the library. Sources of the project come first.
 * Exported for tests.
 */
export function createCitationProvider(
  items: Iterable<Source>,
  projectKeys: ReadonlySet<string>,
): CitationProvider {
  const byKey = new Map<string, Source>();
  const all: CitationSuggestion[] = [];
  for (const item of items) {
    byKey.set(item.citekey, item);
    const detail = [item.authors, item.year].filter(Boolean).join(" ");
    all.push({
      key: item.citekey,
      title: item.title,
      ...(detail ? { detail } : {}),
      group: projectKeys.has(item.citekey) ? "project" : "library",
    });
  }
  return {
    suggest: (query) => filterCitations(all, query),
    resolve(key) {
      const hit = byKey.get(key);
      return hit ? { title: hit.title } : undefined;
    },
  };
}

/** The citation provider of a project, or undefined while the library index loads. */
export function useCitationProvider(project: string): CitationProvider | undefined {
  const links = useLibraryLinks();
  const mine = useOp(itemsList, { project, inbox: false, limit: 500 });
  const index = links.index;
  const projectItems = mine.data?.items;
  return useMemo(() => {
    if (!index) return undefined;
    return createCitationProvider(
      index.items.values(),
      new Set(projectItems?.map((i) => i.citekey)),
    );
  }, [index, projectItems]);
}
