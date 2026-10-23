import { linksDecide, linksPropose, type Registry } from "@citegeist/ops";
import type { Library } from "../library.js";
import { type LinkDeps, LinkService } from "./service.js";

export { linkErrors } from "./errors.js";
export { type LinkDeps, LinkService } from "./service.js";

/**
 * Binds links.propose (a job that asks the AI for typed links and writes them into the note as
 * proposals) and links.decide. links.create and graph.neighbors are bound elsewhere. The runtime
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
    .bind(linksDecide, async (ctx, input) => links.decide(ctx.actor, input));
  return Object.assign(registry, { links });
}
