import { DEFAULT_MODEL, TransformersEmbedder } from "@citegeist/embed";
import { afterAll, describe, expect, it } from "vitest";
import type { Library } from "../library.js";
import { cleanTmpDirs, tmpDir } from "../test-helpers.js";
import { formatMetrics, percentile } from "./eval.js";
import {
  buildGoldenLibrary,
  findCachedModel,
  type GoldenRun,
  loadBaseline,
  loadGoldenQueries,
  openCachedGoldenLibrary,
  runGolden,
} from "./golden.js";
import { SemanticSearch } from "./hybrid.js";

/**
 * The retrieval gate. 43 questions over six CC-BY documents; each names the block that answers
 * it. Full-text search always runs. Hybrid search runs when the default embedding model is in a
 * local cache (never downloaded here, never in CI where CITEGEIST_SKIP_MODELS=1). Both must stay
 * within the tolerance of the numbers recorded in fixtures/retrieval/baseline.json. After a change
 * that improves them on purpose, record the new numbers with `pnpm eval:retrieval --golden --record`.
 */

const baseline = loadBaseline();
const modelsDir = findCachedModel(DEFAULT_MODEL);
const libs: Library[] = [];

afterAll(async () => {
  for (const l of libs) await l.close();
  cleanTmpDirs();
});

function expectWithin(run: GoldenRun, recorded: { hit5: number; mrr: number }, what: string): void {
  const line = `${what}: ${formatMetrics(run.metrics)}`;
  console.log(line);
  const missed = run.results.filter((r) => r.rank === 0 || r.rank > 5).map((r) => `${r.id} ${r.q}`);
  const detail = `${line}\nrecorded hit@5 ${recorded.hit5}, MRR ${recorded.mrr}\nnot in the first 5:\n${missed.join("\n")}`;
  expect(
    run.metrics.hit5,
    `hit@5 fell below ${recorded.hit5} - ${baseline.tolerance.hit5}\n${detail}`,
  ).toBeGreaterThanOrEqual(recorded.hit5 - baseline.tolerance.hit5);
  expect(
    run.metrics.mrr,
    `MRR fell below ${recorded.mrr} - ${baseline.tolerance.mrr}\n${detail}`,
  ).toBeGreaterThanOrEqual(recorded.mrr - baseline.tolerance.mrr);
}

describe("retrieval golden set", () => {
  it("has the recorded number of queries, in both languages", () => {
    const queries = loadGoldenQueries();
    expect(queries).toHaveLength(baseline.queries);
    expect(queries.length).toBeGreaterThanOrEqual(30);
    expect(queries.filter((q) => q.lang === "de").length).toBeGreaterThanOrEqual(10);
    expect(queries.filter((q) => q.lang === "en").length).toBeGreaterThanOrEqual(10);
    expect(new Set(queries.map((q) => q.kind))).toEqual(new Set(["keyword", "conceptual"]));
  });

  it("full-text search stays within the recorded baseline", async () => {
    const lib = await buildGoldenLibrary(tmpDir("cg-golden-"), tmpDir("cg-golden-local-"));
    libs.push(lib);
    const run = await runGolden(lib, async (input) => lib.search(input));
    expectWithin(run, baseline.fts, "full-text");
  });

  it.runIf(modelsDir !== undefined)(
    `hybrid search with ${DEFAULT_MODEL.key} stays within the recorded baseline`,
    async () => {
      const recorded = baseline.hybrid[DEFAULT_MODEL.key];
      expect(
        recorded,
        `no hybrid baseline for ${DEFAULT_MODEL.key}; run pnpm eval:retrieval --golden --record`,
      ).toBeDefined();
      const lib = await openCachedGoldenLibrary(`${modelsDir}/retrieval-golden`);
      libs.push(lib);
      const embedder = new TransformersEmbedder({
        model: DEFAULT_MODEL,
        modelsDir: modelsDir as string,
        localFilesOnly: true,
      });
      try {
        const sem = new SemanticSearch(lib.index, embedder);
        const report = await sem.sync();
        console.log(`embedded ${report.embedded} of ${report.chunks} chunks`);
        const run = await runGolden(lib, (input) => sem.search(input));
        console.log(`latency p50 ${percentile(run.latencyMs, 0.5).toFixed(0)} ms`);
        expectWithin(run, recorded as { hit5: number; mrr: number }, "hybrid");
      } finally {
        await embedder.close();
      }
    },
    30 * 60_000,
  );
});
