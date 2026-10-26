import {
  linksDecide,
  linksForCard,
  linksForItem,
  linksPropose,
  linksRemove,
  linksSuggest,
  type Registry,
} from "@citegeist/ops";
import type { Library } from "../library.js";
import { cardLinks, itemCardLinks, removeLink } from "./card-links.js";
import { type LinkDeps, LinkService } from "./service.js";

export { cardLinks, createCardLink, findLiteratureNote, removeLink } from "./card-links.js";
export { linkErrors } from "./errors.js";
export { type LinkDeps, LinkService } from "./service.js";

/**
 * Binds links.propose (a job that asks the AI for typed links and writes them into the note as
 * proposals), links.decide, links.suggest (the same for a quote card), links.remove,
 * links.forCard and links.forItem. links.create and graph.neighbors are bound elsewhere. The runtime
 * passes the same `ai` and `jobs` it gives the card operations.
 */
export function bindLinkOperations(
  registry: Registry,
  lib: Library,
  deps: LinkDeps,
): Registry & { links: LinkService } {
  const links = new LinkService(lib, deps);
  registry
    .bind(linksPropose, async (ctx, input) => links.propose(ctx.actor, input))
    .bind(linksDecide, async (ctx, input) => links.decide(ctx.actor, input))
    .bind(linksSuggest, async (ctx, input) => links.suggest(ctx.actor, input))
    .bind(linksRemove, async (ctx, input) => removeLink(lib, ctx, input))
    .bind(linksForCard, async (_ctx, input) => ({ links: cardLinks(lib, input.card) }))
    .bind(linksForItem, async (_ctx, input) => ({ links: itemCardLinks(lib, input.citekey) }));
  return Object.assign(registry, { links });
}
