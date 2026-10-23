import {
  cardsList,
  citeFormat,
  documentsAssets,
  graphNeighbors,
  itemsGet,
  itemsList,
  libraryStatus,
  linksCreate,
  notesCreate,
  notesGet,
  notesUpdate,
  projectsCreate,
  projectsGet,
  projectsList,
  projectsUpdate,
  Registry,
  searchQuery,
} from "@citegeist/ops";
import { documentAssets } from "./assets.js";
import { formatCitations } from "./cite-ops.js";
import { neighbors } from "./graph.js";
import type { Library } from "./library.js";
import { createLink } from "./links.js";

/**
 * Binds the handlers this package owns to a registry. Write operations stamp `ctx.actor` on
 * everything they write.
 */
export function bindCoreOperations(registry: Registry, lib: Library): Registry {
  return registry
    .bind(libraryStatus, async () => lib.status())
    .bind(itemsGet, async (_ctx, input) => lib.getItem(input.citekey))
    .bind(itemsList, async (_ctx, input) => lib.listItems(input))
    .bind(documentsAssets, async (_ctx, input) => documentAssets(lib, input))
    .bind(cardsList, async (_ctx, input) => lib.listCards(input))
    .bind(notesGet, async (_ctx, input) => lib.getNote(input.id))
    .bind(notesCreate, async (ctx, input) => lib.createNote(ctx.actor, input))
    .bind(notesUpdate, async (ctx, input) => lib.updateNote(ctx.actor, input))
    .bind(linksCreate, async (ctx, input) => createLink(lib, ctx, input))
    .bind(graphNeighbors, async (_ctx, input) => neighbors(lib, input))
    .bind(citeFormat, async (_ctx, input) => formatCitations(lib, input))
    .bind(projectsCreate, async (ctx, input) => lib.createProject(ctx.actor, input))
    .bind(projectsGet, async (_ctx, input) => lib.getProject(input.slug))
    .bind(projectsList, async () => lib.listProjects())
    .bind(projectsUpdate, async (_ctx, input) => lib.updateProject(input))
    .bind(searchQuery, async (_ctx, input) => ({
      hits: lib.search({
        q: input.q,
        kinds: input.kinds,
        limit: input.limit,
        project: input.project,
        tags: input.tags,
        status: input.status,
      }),
    }));
}

/** A registry with all handlers of this package bound. */
export function createCoreRegistry(lib: Library): Registry {
  return bindCoreOperations(new Registry(), lib);
}
