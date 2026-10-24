import { existsSync } from "node:fs";
import type { GraphWork, LitsearchPaper, LitsearchRunSummary } from "@citegeist/ops";
import { CitegeistError } from "@citegeist/schema";
import { markWorks } from "../graph/marking.js";
import type { Library } from "../library.js";
import {
  listRunSummaries,
  type RunPaper,
  readProgressEvents,
  readRunMeta,
  readRunPapers,
  stagesFromEvents,
} from "./store.js";

/** Bare lowercase DOI, as the library index stores it. */
function bareDoi(doi: string | undefined): string | undefined {
  const d = doi
    ?.trim()
    .toLowerCase()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//, "")
    .replace(/^doi:/, "");
  return d ? d : undefined;
}

/** Family name of "Ana Ruiz" or "Ruiz, Ana". */
function family(name: string): string {
  const n = name.trim();
  if (n.includes(",")) return n.split(",")[0]?.trim() ?? n;
  return n.split(/\s+/).pop() ?? n;
}

/** A paper as the citation graph describes works, for matching against the library. */
export function workOf(p: RunPaper): GraphWork {
  const doi = bareDoi(p.doi);
  return {
    ...(doi ? { doi } : {}),
    ...(p.openalex ? { openalex: p.openalex } : {}),
    ...(p.arxiv ? { arxiv: p.arxiv.replace(/v\d+$/, "") } : {}),
    ...(p.title ? { title: p.title } : {}),
    ...(p.year !== undefined ? { year: p.year } : {}),
    ...(p.authors.length ? { authors: p.authors.map(family).join(", ") } : {}),
  };
}

const RUN_ID = /^[a-z0-9][a-z0-9-]{0,119}$/;

/** Runs of the literature search in <library>/research/runs, read from their folders. */
export class LitsearchService {
  constructor(private readonly lib: Library) {}

  runDir(runId: string): string {
    if (!RUN_ID.test(runId)) {
      throw new CitegeistError({
        code: "LITSEARCH_RUN_ID_INVALID",
        message: `"${runId}" is not a run id.`,
        fix: "Take the id from litsearch.runs.",
        recovery: "fix-and-retry",
        sideEffects: "none",
      });
    }
    return this.lib.paths.litsearchRunDir(runId);
  }

  runs(input: { limit: number; cursor?: string | undefined }): {
    runs: LitsearchRunSummary[];
    next?: string;
  } {
    const all = listRunSummaries(this.lib.paths.litsearchRunsDir);
    const start = input.cursor ? Number.parseInt(input.cursor, 10) || 0 : 0;
    const page = all.slice(start, start + input.limit);
    const end = start + page.length;
    return { runs: page, ...(end < all.length ? { next: String(end) } : {}) };
  }

  get(runId: string) {
    const dir = this.runDir(runId);
    const meta = existsSync(dir) ? readRunMeta(dir, runId) : undefined;
    if (!meta) {
      throw new CitegeistError({
        code: "LITSEARCH_RUN_NOT_FOUND",
        message: `There is no literature search run "${runId}".`,
        fix: "Take the id from litsearch.runs.",
        recovery: "fix-and-retry",
        sideEffects: "none",
      });
    }
    const { stages, error } = stagesFromEvents(readProgressEvents(dir));
    return {
      run: { ...meta, ...(meta.error || !error ? {} : { error }) },
      stages,
      papers: this.mark(readRunPapers(dir)),
    };
  }

  /** Marks each paper as in the library, in the inbox or new, like the citation graph does. */
  mark(papers: RunPaper[]): LitsearchPaper[] {
    const { marked } = markWorks(this.lib, papers.map(workOf));
    return papers.map((p, i) => {
      const m = marked[i];
      return { ...p, status: m?.status ?? "new", ...(m?.citekey ? { citekey: m.citekey } : {}) };
    });
  }
}
