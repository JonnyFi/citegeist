import { defineContract } from "@citegeist/ops";
import { Citekey, OutlineNodeId, PlanSlug, ProjectSlug } from "@citegeist/schema";
import { z } from "zod";

/**
 * Operations the planning screens need that `@citegeist/ops` does not define yet. They are
 * proposals for the lead session: the mock core binds them, the real core does not, so the screens
 * show the core's "unknown operation" error until the contracts land in `packages/ops`.
 *
 * - `plan.docs.get`: read the text of the planning document or of a node document. The spec has
 *   `plan.docs.update` (with `baseHash`) but nothing that returns the text and the hash to pass.
 * - `items.resolve`: look the metadata of an item up again (Crossref, OpenAlex, arXiv ...) and
 *   report which fields changed. Backs "Metadaten neu auflösen" on the source overview.
 */

export const planDocsGet = defineContract({
  name: "plan.docs.get",
  summary:
    "Read the planning document or the document of an outline node: library path, text and sha256 of the file. A node without a document returns an empty text and exists=false.",
  access: "read",
  input: z.object({
    project: ProjectSlug,
    plan: PlanSlug.optional(),
    doc: z.union([z.literal("plan"), OutlineNodeId]).describe("'plan' or a node id"),
  }),
  output: z.object({
    path: z.string(),
    body: z.string(),
    hash: z.string().regex(/^[0-9a-f]{64}$/),
    exists: z.boolean(),
  }),
});

export const itemsResolve = defineContract({
  name: "items.resolve",
  summary:
    "Resolve the metadata of an item again from its DOI, arXiv id, ISBN or URL and merge the result by the usual field priority. Returns the names of the fields that changed.",
  access: "write",
  input: z.object({ citekey: Citekey }),
  output: z.object({ citekey: Citekey, changed: z.array(z.string()) }),
});
