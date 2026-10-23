/**
 * Local check of the whole search path with the real model: the 60 passages of
 * packages/embed/fixtures/retrieval.json become notes in a scratch library, then 20 German and
 * English queries run three ways (full-text only, vectors only, hybrid).
 *
 *   pnpm --filter @citegeist/core retrieval [model-key]
 *
 * Downloads the model into ~/Library/Caches/citegeist-embed-eval on first use. Never runs in CI.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_MODEL, MODELS, TransformersEmbedder } from "@citegeist/embed";
import { MarkdownFile } from "../frontmatter.js";
import { Library } from "../library.js";
import { noteData } from "../test-helpers.js";
import { SemanticSearch } from "./hybrid.js";

interface Fixture {
  passages: { id: string; lang: string; title: string; text: string }[];
  queries: { id: string; lang: string; kind: string; q: string; expect: string }[];
}

const fixture = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../../embed/fixtures/retrieval.json", import.meta.url)),
    "utf8",
  ),
) as Fixture;

const spec = process.argv[2] ? MODELS[process.argv[2]] : DEFAULT_MODEL;
if (!spec) throw new Error(`unknown model; choose from ${Object.keys(MODELS).join(", ")}`);
const cache =
  process.env.CITEGEIST_EVAL_DIR ?? join(homedir(), "Library", "Caches", "citegeist-embed-eval");

const scratch = mkdtempSync(join(tmpdir(), "cg-retrieval-"));
try {
  const root = join(scratch, "lib");
  const lib = await Library.init(root, { watch: false, localBase: join(scratch, "local") });
  const noteOf = new Map<string, string>();
  mkdirSync(join(root, "notes"), { recursive: true });
  for (const p of fixture.passages) {
    const fm = noteData(p.title);
    noteOf.set(fm.id, p.id);
    writeFileSync(
      join(root, "notes", `${p.id}.md`),
      MarkdownFile.create(fm as Record<string, unknown>, p.text).toString(),
    );
  }
  lib.sync();

  const embedder = new TransformersEmbedder({ model: spec, modelsDir: cache });
  const sem = new SemanticSearch(lib.index, embedder);
  const t0 = performance.now();
  const report = await sem.sync();
  console.log(
    `model ${embedder.id}: embedded ${report.embedded} chunks in ${((performance.now() - t0) / 1000).toFixed(1)} s`,
  );

  const ranks: Record<string, number[]> = { fulltext: [], vectors: [], hybrid: [] };
  const detail: string[] = [];
  for (const q of fixture.queries) {
    const base = { q: q.q, kinds: ["note" as const], limit: 10 };
    const lex = lib.search(base).map((h) => noteOf.get(h.id));
    const qv = await embedder.embedQuery(q.q);
    const vec = sem.store.nearest(qv, { kinds: ["note"] }, 10).map((h) => noteOf.get(h.ref));
    const hyb = (await sem.search(base)).map((h) => noteOf.get(h.id));
    const rank = (list: (string | undefined)[]): number => {
      const i = list.indexOf(q.expect);
      return i < 0 ? 0 : i + 1;
    };
    ranks.fulltext?.push(rank(lex));
    ranks.vectors?.push(rank(vec));
    ranks.hybrid?.push(rank(hyb));
    detail.push(
      `${q.id} ${q.lang} ${q.kind.padEnd(10)} fulltext ${rank(lex) || "-"}  vectors ${rank(vec) || "-"}  hybrid ${rank(hyb) || "-"}  ${q.q}`,
    );
  }
  const n = fixture.queries.length;
  console.log(`\n${"mode".padEnd(10)} hit@1  hit@3  hit@5  hit@10  MRR`);
  for (const [mode, rs] of Object.entries(ranks)) {
    const at = (k: number): number => rs.filter((r) => r > 0 && r <= k).length;
    const mrr = rs.reduce((s, r) => s + (r > 0 ? 1 / r : 0), 0) / n;
    console.log(
      `${mode.padEnd(10)} ${String(at(1)).padStart(2)}/${n}  ${String(at(3)).padStart(2)}/${n}  ${String(at(5)).padStart(2)}/${n}  ${String(at(10)).padStart(2)}/${n}   ${mrr.toFixed(3)}`,
    );
  }
  console.log(`\n${detail.join("\n")}`);
  await embedder.close();
  await lib.close();
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
