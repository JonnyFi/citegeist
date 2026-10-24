/**
 * Measures search quality: hit@k and MRR of full-text and hybrid search over a set of queries.
 *
 *   pnpm eval:retrieval --golden [--record]
 *   pnpm eval:retrieval --library <path> --queries <file>
 *
 * `--golden` runs the committed golden set (fixtures/retrieval). `--library` runs a queries file
 * against a real library. The queries file lives outside the repository: real library data is
 * never committed. The library is only read; its index (with the vectors the app already
 * computed) is copied into a scratch folder first.
 *
 * Options: --mode fts|hybrid|both (default both)  --model <key>  --models-dir <dir>
 *          --kinds block,item,card,note  --limit <n>  --details  --json
 *          --rerank [<reranker key>]  (also measure with the cross-encoder reranker)
 *          --record  (golden only: write the numbers into fixtures/retrieval/baseline.json)
 *
 * Models come from the local cache (see findCachedModel) and are downloaded into --models-dir
 * (default: the app's models folder) when missing.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import {
  DEFAULT_MODEL,
  MODELS,
  type ModelSpec,
  RERANKERS,
  TransformersEmbedder,
  TransformersReranker,
} from "@citegeist/embed";
import Database from "better-sqlite3";
import { Library } from "../library.js";
import { defaultLocalBase } from "../paths.js";
import type { HitKind, SearchHit, SearchInput } from "../search.js";
import {
  formatMetrics,
  Judge,
  loadQueries,
  type Metrics,
  metrics,
  percentile,
  type QueryResult,
  runQueries,
} from "./eval.js";
import {
  findCachedModel,
  loadBaseline,
  openCachedGoldenLibrary,
  runGolden,
  saveBaseline,
  toEntry,
} from "./golden.js";
import { SemanticSearch } from "./hybrid.js";

const { values: opt } = parseArgs({
  options: {
    golden: { type: "boolean", default: false },
    library: { type: "string" },
    queries: { type: "string" },
    mode: { type: "string", default: "both" },
    model: { type: "string" },
    "models-dir": { type: "string" },
    kinds: { type: "string" },
    limit: { type: "string", default: "10" },
    details: { type: "boolean", default: false },
    json: { type: "boolean", default: false },
    rerank: { type: "string" },
    record: { type: "boolean", default: false },
  },
  allowPositionals: false,
});

if (opt.golden === (opt.library !== undefined)) {
  console.error("Use either --golden or --library <path> --queries <file>.");
  process.exit(2);
}
if (opt.library && !opt.queries) {
  console.error("--library needs --queries <file>.");
  process.exit(2);
}

const spec: ModelSpec = opt.model ? (MODELS[opt.model] as ModelSpec) : DEFAULT_MODEL;
if (!spec) throw new Error(`unknown model; choose from ${Object.keys(MODELS).join(", ")}`);
const rerankKey = opt.rerank === undefined ? undefined : opt.rerank || "default";
const mode = opt.mode ?? "both";
const limit = Number(opt.limit);
const kinds = (opt.kinds?.split(",") as HitKind[] | undefined) ?? undefined;

interface Row {
  name: string;
  metrics: Metrics;
  results: QueryResult[];
  latencyMs: number[];
}
const rows: Row[] = [];
const scratch = mkdtempSync(join(tmpdir(), "cg-eval-"));

function modelsDir(model: Pick<ModelSpec, "repo" | "revision">): string {
  return opt["models-dir"] ?? findCachedModel(model) ?? join(defaultLocalBase(), "models");
}

/** Opens a real library without touching its files or the app's index. */
async function openReal(path: string): Promise<Library> {
  const manifest = JSON.parse(readFileSync(join(path, "citegeist.json"), "utf8")) as { id: string };
  const localBase = join(scratch, "local");
  const dest = join(localBase, manifest.id);
  mkdirSync(dest, { recursive: true });
  const source = join(defaultLocalBase(), manifest.id, "index.sqlite");
  if (existsSync(source)) {
    const src = new Database(source, { readonly: true, fileMustExist: true });
    try {
      await src.backup(join(dest, "index.sqlite"));
    } finally {
      src.close();
    }
  }
  return Library.open(path, { watch: false, localBase });
}

async function main(): Promise<void> {
  const lib = opt.golden
    ? await openCachedGoldenLibrary(join(modelsDir(spec), "retrieval-golden"))
    : await openReal(opt.library as string);
  const queries = opt.golden ? undefined : loadQueries(opt.queries as string);
  const searchKinds = kinds ?? (opt.golden ? undefined : (["item", "card", "block"] as HitKind[]));
  const withKinds = (input: SearchInput): SearchInput => ({
    ...input,
    ...(searchKinds ? { kinds: searchKinds } : {}),
    limit,
  });

  const run = async (
    name: string,
    searchFn: (input: SearchInput) => Promise<SearchHit[]>,
  ): Promise<void> => {
    if (queries) {
      const judge = new Judge(lib.index);
      const stale = queries.flatMap((q) =>
        q.expect
          .filter((x) => judge.matches(x) === 0)
          .map((x) => `${q.id}: ${x.item} ${x.contains ?? ""}`),
      );
      if (stale.length > 0)
        console.warn(`not found in the library (counted as misses):\n${stale.join("\n")}`);
      const out = await runQueries(queries, judge, (q) => searchFn(withKinds({ q })));
      rows.push({ name, metrics: metrics(out.results), ...out });
    } else {
      const out = await runGolden(lib, (input) => searchFn({ ...input, ...withKinds(input) }));
      rows.push({ name, ...out });
    }
  };

  if (mode === "fts" || mode === "both") await run("full-text", async (i) => lib.search(i));

  if (mode === "hybrid" || mode === "both") {
    const dir = modelsDir(spec);
    const embedder = new TransformersEmbedder({
      model: spec,
      modelsDir: dir,
      ...(findCachedModel(spec) === dir ? { localFilesOnly: true } : {}),
    });
    try {
      const sem = new SemanticSearch(lib.index, embedder);
      const t0 = performance.now();
      const report = await sem.sync();
      console.error(
        `${spec.key}: ${report.embedded} of ${report.chunks} chunks embedded in ${((performance.now() - t0) / 1000).toFixed(1)} s`,
      );
      await run(`hybrid ${spec.key}`, (i) => sem.search(i));
      if (rerankKey) {
        const rspec = rerankKey === "default" ? RERANKERS.default : RERANKERS[rerankKey];
        if (!rspec)
          throw new Error(`unknown reranker; choose from ${Object.keys(RERANKERS).join(", ")}`);
        const reranker = new TransformersReranker({ model: rspec, modelsDir: modelsDir(rspec) });
        try {
          await reranker.warmup();
          const semR = new SemanticSearch(lib.index, embedder, { reranker });
          await run(`hybrid ${spec.key} + ${rspec.key}`, (i) => semR.search(i));
        } finally {
          await reranker.close();
        }
      }
    } finally {
      await embedder.close();
    }
  }

  report(rows);
  if (opt.record) record();
  await lib.close();
}

function report(list: Row[]): void {
  if (opt.json) {
    console.log(
      JSON.stringify(
        list.map((r) => ({ name: r.name, ...r.metrics })),
        null,
        2,
      ),
    );
    return;
  }
  for (const r of list) {
    console.log(`${r.name.padEnd(40)} ${formatMetrics(r.metrics)}`);
    console.log(
      `${"".padEnd(40)} latency p50 ${percentile(r.latencyMs, 0.5).toFixed(0)} ms, p95 ${percentile(r.latencyMs, 0.95).toFixed(0)} ms`,
    );
  }
  if (opt.details) {
    for (const r of list) {
      console.log(`\n${r.name}`);
      for (const x of r.results) {
        console.log(
          `${x.id} ${(x.lang ?? "").padEnd(2)} ${(x.kind ?? "").padEnd(10)} rank ${String(x.rank || "-").padStart(2)}  item ${String(x.itemRank || "-").padStart(2)}  ${x.q}`,
        );
      }
    }
  }
}

function record(): void {
  if (!opt.golden) throw new Error("--record only works with --golden");
  const baseline = loadBaseline();
  baseline.queries = rows[0]?.metrics.queries ?? baseline.queries;
  for (const r of rows) {
    if (r.name === "full-text") baseline.fts = toEntry(r.metrics);
    else baseline.hybrid[r.name.replace(/^hybrid /, "")] = toEntry(r.metrics);
  }
  saveBaseline(baseline);
  console.error("recorded in fixtures/retrieval/baseline.json");
}

try {
  await main();
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
