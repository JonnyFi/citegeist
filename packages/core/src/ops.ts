import {
  cardsList,
  citeFormat,
  documentsAssets,
  graphNeighbors,
  graphProject,
  itemsGet,
  itemsList,
  libraryStatus,
  linksCreate,
  notesCreate,
  notesGet,
  notesUpdate,
  projectsAddItems,
  projectsCreate,
  projectsGet,
  projectsList,
  projectsRemoveItems,
  projectsUpdate,
  Registry,
  searchQuery,
} from "@citegeist/ops";
import { documentAssets } from "./assets.js";
import { formatCitations } from "./cite-ops.js";
import { neighbors, projectGraph } from "./graph.js";
import type { Library } from "./library.js";
import { createLink } from "./links.js";
import { changeProjectItems } from "./project-items.js";
import type { SearchHit, SearchInput } from "./search.js";

export interface CoreOperationOptions {
  /**
   * Search behind `search.query`. Default: full-text search of the index. The runtime passes the
   * hybrid search once semantic search is on, which has to embed the query and so is async.
   */
  search?: (input: SearchInput) => Promise<SearchHit[]>;
}

/**
 * Binds the handlers this package owns to a registry. Write operations stamp `ctx.actor` on
 * everything they write.
 */
export function bindCoreOperations(
  registry: Registry,
  lib: Library,
  opts: CoreOperationOptions = {},
): Registry {
  const search = opts.search ?? (async (input: SearchInput) => lib.search(input));
  return registry
    .bind(libraryStatus, async () => lib.status())
    .bind(itemsGet, async (_ctx, input) => lib.getItem(input.citekey))
    .bind(itemsList, async (_ctx, input) =>
      lib.listItems({
        ...input,
        // accepted items only, unless the caller asks for the inbox
        inbox: input.inbox ?? (input.includeInbox ? undefined : false),
      }),
    )
    .bind(documentsAssets, async (_ctx, input) => documentAssets(lib, input))
    .bind(cardsList, async (_ctx, input) => lib.listCards(input))
    .bind(notesGet, async (_ctx, input) => lib.getNote(input.id))
    .bind(notesCreate, async (ctx, input) => lib.createNote(ctx.actor, input))
    .bind(notesUpdate, async (ctx, input) => lib.updateNote(ctx.actor, input))
    .bind(linksCreate, async (ctx, input) => createLink(lib, ctx, input))
    .bind(graphNeighbors, async (_ctx, input) => neighbors(lib, input))
    .bind(graphProject, async (_ctx, input) => projectGraph(lib, input))
    .bind(citeFormat, async (_ctx, input) => formatCitations(lib, input))
    .bind(projectsCreate, async (ctx, input) => lib.createProject(ctx.actor, input))
    .bind(projectsGet, async (_ctx, input) => lib.getProject(input.slug))
    .bind(projectsList, async () => lib.listProjects())
    .bind(projectsUpdate, async (_ctx, input) => lib.updateProject(input))
    .bind(projectsAddItems, async (ctx, input) => {
      const r = changeProjectItems(lib, ctx.actor, "add", input.slug, input.citekeys);
      return { added: r.changed, unchanged: r.unchanged };
    })
    .bind(projectsRemoveItems, async (ctx, input) => {
      const r = changeProjectItems(lib, ctx.actor, "remove", input.slug, input.citekeys);
      return { removed: r.changed, unchanged: r.unchanged };
    })
    .bind(searchQuery, async (ctx, input) => {
      // A person searches accepted items. An agent also sees the inbox, where its proposals wait.
      const withInbox = input.includeInbox ?? ctx.actor.startsWith("agent:");
      const hits = await search({
        q: input.q,
        kinds: input.kinds,
        limit: input.limit,
        project: input.project,
        tags: input.tags,
        status: input.status,
        ...(withInbox ? {} : { inbox: false }),
      });
      return { hits: markInbox(lib, hits) };
    });
}

/** A registry with all handlers of this package bound. */
export function createCoreRegistry(lib: Library): Registry {
  return bindCoreOperations(new Registry(), lib);
}

/** Marks the hits that belong to an item in the inbox. */
function markInbox(lib: Library, hits: SearchHit[]): SearchHit[] {
  const keys = [...new Set(hits.flatMap((h) => (h.citekey ? [h.citekey] : [])))];
  if (keys.length === 0) return hits;
  const waiting = new Set(
    lib.index
      .all<{ citekey: string }>(
        `SELECT citekey FROM items WHERE inbox = 1 AND citekey IN (${keys.map(() => "?").join(",")})`,
        ...keys,
      )
      .map((r) => r.citekey),
  );
  if (waiting.size === 0) return hits;
  return hits.map((h) =>
    h.citekey && waiting.has(h.citekey) ? { ...h, inbox: true as const } : h,
  );
}
