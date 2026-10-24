import { extractPdfText, type Library, type Runtime } from "@citegeist/core";
import { bindImportOperations, createLibraryHost } from "@citegeist/import";
import { extractIdentifiers, pickPrimary } from "@citegeist/metadata";

/**
 * Binds import.preview and import.run to a runtime. It lives here and not in the core's runtime,
 * because @citegeist/import has the core as a dev dependency (its integration test), so the core
 * cannot depend on it. The run is a job of the runtime's queue and writes as the actor "system".
 */
export function bindImport(runtime: Runtime, library: Library): void {
  bindImportOperations(runtime.registry, {
    host: createLibraryHost(library),
    queue: runtime.ingest.queue,
    // Leftover PDFs of a folder import are matched to BibTeX entries by the DOI on their first pages.
    pdfDoi: async (path) => {
      const text = await extractPdfText(path);
      const found = pickPrimary(extractIdentifiers(text.leading).filter((i) => i.kind === "doi"));
      return found?.value;
    },
  });
}
