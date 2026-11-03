import {
  cardsCreate,
  cardsDelete,
  cardsExport,
  cardsRegenerate,
  cardsRestore,
  cardsUpdate,
  documentsConfirmPages,
  type Registry,
} from "@citegeist/ops";
import type { Library } from "../library.js";
import { type CardDeps, CardService } from "./service.js";
import { restoreCard, trashCard } from "./trash.js";

/**
 * Binds cards.create, cards.update, cards.delete, cards.restore, cards.regenerate, cards.export and
 * documents.confirmPages.
 * Returns the registry and the service (tests and the app use the service to wait for jobs).
 */
export function bindCardOperations(
  registry: Registry,
  lib: Library,
  deps: CardDeps,
): Registry & { cards: CardService } {
  const cards = new CardService(lib, deps);
  registry
    .bind(cardsCreate, async (ctx, input) => cards.create(ctx.actor, input))
    .bind(cardsUpdate, async (ctx, input) =>
      cards.update(ctx.actor, { id: input.id, patch: input.patch as Record<string, unknown> }),
    )
    .bind(cardsDelete, async (ctx, input) => {
      trashCard(lib, input.id, ctx.actor, { force: input.force === true });
      return { ok: true as const };
    })
    .bind(cardsRestore, async (ctx, input) => {
      restoreCard(lib, input.id, ctx.actor);
      return { card: cards.getCard(input.id) };
    })
    .bind(cardsRegenerate, async (ctx, input) => cards.regenerate(ctx.actor, input))
    .bind(cardsExport, async (_ctx, input) => cards.export(input))
    .bind(documentsConfirmPages, async (ctx, input) => cards.confirmPages(ctx.actor, input));
  return Object.assign(registry, { cards });
}
