import { defineContract } from "@citegeist/ops";
import { Block, Citekey, Pages, SourceHash } from "@citegeist/schema";
import { z } from "zod";

/**
 * Raw source and derived files for the reader. The ops registry has no such operation yet, so the
 * contract lives here and only the mock core implements it. The change request for the lead is
 * to add it to `packages/ops/src/contracts` and bind it in the core:
 *
 * - `pdfUrl`: a URL the renderer can `fetch` for the PDF bytes (the core serves
 *   `sources/<hash>.pdf` on its local HTTP port; the token travels in the URL query).
 * - `html`: the contents of `derived/<hash>/doc.html`.
 * - `blocks`: `derived/<hash>/blocks.jsonl`, needed to anchor selections to block ids.
 * - `pages`: `derived/<hash>/pages.json`, with printed page labels and the `confirmed` flag.
 */
export const documentsAssets = defineContract({
  name: "documents.assets",
  summary:
    "Source PDF URL, doc.html, blocks and page labels of an item's main source for the reader",
  access: "read",
  input: z.object({ citekey: Citekey, source: SourceHash.optional() }),
  output: z.object({
    source: SourceHash,
    pdfUrl: z.string().optional(),
    html: z.string().optional(),
    blocks: z.array(Block),
    pages: Pages.optional(),
  }),
});

export type DocumentAssets = z.output<typeof documentsAssets.output>;
