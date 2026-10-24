import {
  filterSuggestions,
  type ResolvedLink,
  type Suggestion,
  type WikiLinkProvider,
} from "@citegeist/editor";
import type { NumberedNode } from "@citegeist/ops";
import { nodeLabel } from "./outline";

/**
 * Adds the outline nodes of a plan to the library's wiki-link provider: `[[k_...]]` resolves, and
 * the autocomplete offers the nodes by number and title. The link text shows "3.1 Titel" because
 * the label is what the editor displays for a resolved link.
 */
export function withNodeLinks(
  base: WikiLinkProvider | undefined,
  nodes: readonly NumberedNode[],
  detail: string,
): WikiLinkProvider {
  const suggestions: Suggestion[] = nodes.map((n) => ({
    kind: "note",
    target: n.id,
    label: nodeLabel(n),
    detail,
  }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  return {
    async suggest(query, options) {
      const own = options.embed ? [] : filterSuggestions(suggestions, query);
      const rest = base ? await base.suggest(query, options) : [];
      return [...own, ...rest];
    },
    resolve(target): ResolvedLink | undefined {
      const node = byId.get(target);
      if (node) return { kind: "note", label: nodeLabel(node) };
      return base?.resolve(target);
    },
    ...(base?.card ? { card: base.card.bind(base) } : {}),
  };
}
