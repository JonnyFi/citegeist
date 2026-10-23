import {
  documentsConvert,
  documentsRead,
  inboxAccept,
  inboxReject,
  itemsAdd,
  itemsRename,
  itemsTrash,
  itemsUpdate,
  type Registry,
} from "@citegeist/ops";
import { bindJobOperations } from "../jobs/index.js";
import type { Library } from "../library.js";
import { type IngestDeps, IngestService } from "./service.js";

export { parseDocMd, type ReadInput, type ReadResult, readDocument } from "./documents.js";
export { type DuplicateQuery, findDuplicate } from "./dupes.js";
export { rewriteWikiLinks } from "./items.js";
export {
  extractPdfText,
  guessHeader,
  type HeaderGuess,
  type PdfText,
  type PdfTextExtractor,
} from "./pdf-text.js";
export {
  type AddInput,
  type AddResult,
  type IngestDeps,
  IngestService,
  type MetadataLookup,
} from "./service.js";
export {
  ChildProcessConvertWorker,
  type ChildProcessWorkerOptions,
  type ConvertCallOptions,
  type ConvertWorker,
  createStubWorker,
  STUB_WORKER_PATH,
  WorkerTransientError,
} from "./worker.js";

/**
 * Binds items.add, items.update, items.rename, items.trash, inbox.accept, inbox.reject,
 * documents.read, documents.convert, jobs.get and jobs.list. Returns the service, which owns the
 * job queue and the conversion worker: call `service.close()` when the library closes.
 */
export function bindIngestOperations(
  registry: Registry,
  lib: Library,
  deps: IngestDeps,
): IngestService {
  const svc = new IngestService(lib, deps);
  bindJobOperations(registry, svc.queue);
  registry
    .bind(itemsAdd, async (ctx, input) => svc.addItem(ctx.actor, input))
    .bind(itemsUpdate, async (ctx, input) => svc.updateItem(ctx.actor, input.citekey, input.patch))
    .bind(itemsRename, async (ctx, input) => svc.renameItem(ctx.actor, input.citekey, input.to))
    .bind(itemsTrash, async (_ctx, input) => {
      svc.trashItem(input.citekey);
      return { ok: true as const };
    })
    .bind(inboxAccept, async (ctx, input) => {
      svc.acceptInbox(ctx.actor, input.citekeys);
      return { ok: true as const };
    })
    .bind(inboxReject, async (_ctx, input) => {
      svc.rejectInbox(input.citekeys);
      return { ok: true as const };
    })
    .bind(documentsRead, async (_ctx, input) => svc.readDocument(input))
    .bind(documentsConvert, async (ctx, input) =>
      svc.convertItem(ctx.actor, input.citekey, input.force),
    );
  return svc;
}
