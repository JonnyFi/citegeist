import {
  documentsConvert,
  documentsRead,
  inboxAccept,
  inboxReject,
  itemsAdd,
  itemsAttach,
  itemsRename,
  itemsResolve,
  itemsRestore,
  itemsTrash,
  itemsUpdate,
  type Registry,
} from "@citegeist/ops";
import { CitegeistError } from "@citegeist/schema";
import { bindJobOperations } from "../jobs/index.js";
import type { Library } from "../library.js";
import { resolveItem } from "./resolve.js";
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
export { resolveItem } from "./resolve.js";
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

/** Refuses a call that would read a local file when the caller's token does not allow it. */
function refuseLocalFiles(what: string): never {
  throw new CitegeistError({
    code: "LOCAL_FILES_FORBIDDEN",
    message: `${what} reads a file on this Mac, which this session may not do`,
    fix: "Add the work by DOI, arXiv id, ISBN or the URL of a public page instead.",
    recovery: "fix-and-retry",
  });
}

/**
 * Binds items.add, items.attach, items.update, items.resolve, items.rename, items.trash, inbox.accept, inbox.reject,
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
    .bind(itemsAdd, async (ctx, input) => {
      if (ctx.localFiles === false && svc.namesLocalFile(input.identifier)) {
        refuseLocalFiles("items.add with this identifier");
      }
      return svc.addItem(ctx.actor, input);
    })
    .bind(itemsAttach, async (ctx, input) => {
      if (ctx.localFiles === false) refuseLocalFiles("items.attach");
      return svc.attachFile(ctx.actor, input);
    })
    .bind(itemsUpdate, async (ctx, input) => svc.updateItem(ctx.actor, input.citekey, input.patch))
    .bind(itemsResolve, async (ctx, input) =>
      resolveItem({ lib, resolver: svc.deps.resolver }, ctx.actor, input.citekey),
    )
    .bind(itemsRename, async (ctx, input) => svc.renameItem(ctx.actor, input.citekey, input.to))
    .bind(itemsTrash, async (ctx, input) => {
      svc.trashItem(ctx.actor, input.citekey);
      return { ok: true as const };
    })
    .bind(itemsRestore, async (_ctx, input) => {
      svc.restoreItem(input.citekey);
      return { ok: true as const };
    })
    .bind(inboxAccept, async (ctx, input) => {
      svc.acceptInbox(ctx.actor, input.citekeys);
      return { ok: true as const };
    })
    .bind(inboxReject, async (ctx, input) => {
      svc.rejectInbox(input.citekeys, ctx.actor);
      return { ok: true as const };
    })
    .bind(documentsRead, async (_ctx, input) => svc.readDocument(input))
    .bind(documentsConvert, async (ctx, input) =>
      svc.convertItem(ctx.actor, input.citekey, input.force),
    );
  return svc;
}
