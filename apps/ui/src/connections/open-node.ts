import { cardsList } from "@citegeist/ops";
import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import { useCore } from "../lib/hooks";
import type { GraphEdge, GraphNode } from "./model";

/**
 * Opens a node of the graph in its own view: items and notes directly, cards in the reader of
 * their item. The item of a card comes from its excerpt-of edge; without one the card is looked
 * up by its text.
 */
export function useOpenNode(edges: readonly GraphEdge[]) {
  const navigate = useNavigate();
  const core = useCore();
  return useCallback(
    async (node: Pick<GraphNode, "id" | "kind" | "label">) => {
      if (node.kind === "note") {
        await navigate({ to: "/notes/$id", params: { id: node.id } });
        return;
      }
      if (node.kind === "item") {
        await navigate({ to: "/items/$citekey", params: { citekey: node.id } });
        return;
      }
      let citekey = edges.find((e) => e.from === node.id && e.rel === "excerpt-of")?.to;
      if (!citekey) {
        const found = await core.call(cardsList, { query: node.label.slice(0, 60), limit: 50 });
        citekey = found.cards.find((c) => c.frontmatter.id === node.id)?.frontmatter.item;
      }
      if (!citekey) return;
      await navigate({
        to: "/items/$citekey",
        params: { citekey },
        search: { tab: "read", card: node.id },
      });
    },
    [navigate, core, edges],
  );
}
