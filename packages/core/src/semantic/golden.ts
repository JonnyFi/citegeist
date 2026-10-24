import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ModelSpec } from "@citegeist/embed";
import { ItemFrontmatter } from "@citegeist/schema";
import { ulid } from "../ids.js";
import { Library } from "../library.js";
import type { SearchHit, SearchInput } from "../search.js";
import { STAMP } from "../test-helpers.js";
import {
  type EvalQuery,
  Judge,
  loadQueries,
  type Metrics,
  metrics,
  type QueryResult,
  runQueries,
} from "./eval.js";

/**
 * The retrieval golden set: six CC-BY documents converted to blocks (fixtures/retrieval/corpus),
 * their metadata, 40 queries with the blocks that answer them, and the recorded baseline.
 */
export const GOLDEN_DIR = fileURLToPath(
  new URL("../../../../fixtures/retrieval/", import.meta.url),
);

export interface GoldenItem {
  citekey: string;
  fixture: string;
  title: string;
  author: { family: string; given?: string }[];
  year: number;
  language: string;
  doi?: string;
}

export interface BaselineEntry {
  hit5: number;
  mrr: number;
}

export interface Baseline {
  /** How far hit@5 and MRR may fall below the recorded value before the test fails. */
  tolerance: { hit5: number; mrr: number };
  queries: number;
  /** Full-text search only, which is what CI and machines without a model run. */
  fts: BaselineEntry;
  /** Hybrid search by embedding model key, with `+rerank` appended when the reranker is on. */
  hybrid: Record<string, BaselineEntry>;
}

export function loadGoldenQueries(): EvalQuery[] {
  return loadQueries(join(GOLDEN_DIR, "queries.json"));
}

export function loadBaseline(): Baseline {
  return JSON.parse(readFileSync(join(GOLDEN_DIR, "baseline.json"), "utf8")) as Baseline;
}

export function saveBaseline(b: Baseline): void {
  writeFileSync(join(GOLDEN_DIR, "baseline.json"), `${JSON.stringify(b, null, 2)}\n`);
}

export function toEntry(m: Metrics): BaselineEntry {
  return { hit5: round(m.hit5), mrr: round(m.mrr) };
}

const round = (x: number): number => Math.round(x * 1000) / 1000;

function goldenItems(): GoldenItem[] {
  return (
    JSON.parse(readFileSync(join(GOLDEN_DIR, "items.json"), "utf8")) as { items: GoldenItem[] }
  ).items;
}

/** Changes whenever the corpus or the item metadata change; names the cache folder. */
export function corpusFingerprint(): string {
  const h = createHash("sha256");
  h.update(readFileSync(join(GOLDEN_DIR, "items.json")));
  for (const f of readdirSync(join(GOLDEN_DIR, "corpus")).sort()) {
    h.update(f);
    h.update(readFileSync(join(GOLDEN_DIR, "corpus", f)));
  }
  return h.digest("hex").slice(0, 12);
}

/** Builds the golden library in `root` (an empty folder) with its index under `localBase`. */
export async function buildGoldenLibrary(root: string, localBase: string): Promise<Library> {
  const lib = await Library.init(root, { id: "golden-retrieval", watch: false, localBase });
  for (const it of goldenItems()) {
    lib.writeItem(
      ItemFrontmatter.parse({
        id: ulid(),
        citekey: it.citekey,
        type: "article-journal",
        title: it.title,
        author: it.author,
        issued: it.year,
        language: it.language,
        ...(it.doi ? { DOI: it.doi } : {}),
        created: STAMP,
      }),
    );
    const blocks = readFileSync(join(GOLDEN_DIR, "corpus", `${it.fixture}.jsonl`), "utf8");
    const hash = createHash("sha256").update(it.fixture).digest("hex").slice(0, 12);
    lib.writeFile(`items/${it.citekey}/derived/${hash}/blocks.jsonl`, blocks);
  }
  lib.sync();
  return lib;
}

/**
 * The golden library in a cache folder, so the vectors survive between runs and only changed
 * chunks are embedded again. A different corpus gets a different folder.
 */
export async function openCachedGoldenLibrary(cacheRoot: string): Promise<Library> {
  const dir = join(cacheRoot, `golden-${corpusFingerprint()}`);
  const root = join(dir, "lib");
  const localBase = join(dir, "local");
  if (existsSync(join(root, "citegeist.json"))) {
    return Library.open(root, { watch: false, localBase });
  }
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return buildGoldenLibrary(root, localBase);
}

/** Folders that may hold the Transformers.js model cache (`<dir>/transformers/...`), best first. */
export function modelDirCandidates(): string[] {
  const out: string[] = [];
  if (process.env.CITEGEIST_MODELS_DIR) out.push(process.env.CITEGEIST_MODELS_DIR);
  if (process.env.CITEGEIST_EVAL_DIR) out.push(process.env.CITEGEIST_EVAL_DIR);
  out.push(join(homedir(), "Library", "Caches", "citegeist-embed-eval"));
  out.push(join(homedir(), "Library", "Application Support", "citegeist", "models"));
  return out;
}

/**
 * The folder where the files of `spec` are already on disk, or undefined. Never downloads, and
 * is always undefined when CITEGEIST_SKIP_MODELS=1 (CI).
 */
export function findCachedModel(spec: Pick<ModelSpec, "repo" | "revision">): string | undefined {
  if (process.env.CITEGEIST_SKIP_MODELS === "1") return undefined;
  return modelDirCandidates().find((dir) =>
    existsSync(join(dir, "transformers", spec.repo, spec.revision, "onnx")),
  );
}

export interface GoldenRun {
  results: QueryResult[];
  metrics: Metrics;
  latencyMs: number[];
}

/** Runs the golden queries against block search of `lib` through `searchFn`. */
export async function runGolden(
  lib: Library,
  searchFn: (input: SearchInput) => Promise<SearchHit[]>,
): Promise<GoldenRun> {
  const queries = loadGoldenQueries();
  const judge = new Judge(lib.index);
  const stale = queries.flatMap((q) =>
    q.expect.filter((x) => judge.matches(x) === 0).map((x) => `${q.id}: ${x.contains ?? x.item}`),
  );
  if (stale.length > 0) {
    throw new Error(
      `queries.json points at blocks that are not in the corpus:\n${stale.join("\n")}`,
    );
  }
  const { results, latencyMs } = await runQueries(queries, judge, (q) =>
    searchFn({ q, kinds: ["block"], limit: 10 }),
  );
  return { results, metrics: metrics(results), latencyMs };
}
