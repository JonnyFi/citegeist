/**
 * Local retrieval check: 20 German and English queries over the passages in
 * fixtures/retrieval.json, dense retrieval only (cosine similarity).
 *
 *   pnpm --filter @citegeist/embed retrieval -- qwen3-embedding-0.6b embeddinggemma-300m
 *
 * Downloads the models into ~/Library/Caches/citegeist-embed-eval on first use (CITEGEIST_EVAL_DIR
 * overrides). Never runs in CI.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dot, MODELS, TransformersEmbedder } from "../src/index.js";

interface Passage {
  id: string;
  lang: string;
  title: string;
  text: string;
}
interface Query {
  id: string;
  lang: string;
  kind: string;
  q: string;
  expect: string;
}

const fixture = JSON.parse(
  readFileSync(join(fileURLToPath(new URL("../fixtures/retrieval.json", import.meta.url))), "utf8"),
) as { passages: Passage[]; queries: Query[] };

const dir =
  process.env.CITEGEIST_EVAL_DIR ?? join(homedir(), "Library", "Caches", "citegeist-embed-eval");
const keys = process.argv.slice(2).filter((a) => a !== "--");
if (keys.length === 0) keys.push(...Object.keys(MODELS));

for (const key of keys) {
  const spec = MODELS[key];
  if (!spec) throw new Error(`unknown model ${key}; choose from ${Object.keys(MODELS).join(", ")}`);
  const embedder = new TransformersEmbedder({
    model: spec,
    modelsDir: dir,
    onDownload: (p) => {
      if (p.progress === 1) console.error(`  downloaded ${p.file}`);
    },
  });
  console.log(
    `\n== ${key} (${spec.dtype}, ${spec.dimensions} dims, revision ${spec.revision.slice(0, 8)})`,
  );
  let t = performance.now();
  await embedder.warmup();
  console.log(`load: ${((performance.now() - t) / 1000).toFixed(1)} s`);

  t = performance.now();
  const docs = await embedder.embedDocuments(fixture.passages.map((p) => `${p.title}\n${p.text}`));
  const docSeconds = (performance.now() - t) / 1000;
  const chars = fixture.passages.reduce((n, p) => n + p.title.length + p.text.length + 1, 0);
  console.log(
    `documents: ${fixture.passages.length} in ${docSeconds.toFixed(1)} s (${(chars / 4 / docSeconds).toFixed(0)} tokens/s, estimated at 4 chars per token)`,
  );

  let r1 = 0;
  let r3 = 0;
  let r5 = 0;
  let mrr = 0;
  const by: Record<string, { n: number; hit3: number }> = {};
  const misses: string[] = [];
  const gaps: number[] = [];
  const tops: number[] = [];
  for (const q of fixture.queries) {
    const qv = await embedder.embedQuery(q.q);
    const scored = fixture.passages
      .map((p, i) => ({ id: p.id, score: dot(qv, docs[i] as Float32Array) }))
      .sort((a, b) => b.score - a.score);
    const rank = scored.findIndex((s) => s.id === q.expect) + 1;
    if (rank === 1) r1++;
    if (rank <= 3) r3++;
    if (rank <= 5) r5++;
    mrr += 1 / rank;
    for (const k of [q.lang, q.kind]) {
      const e = by[k] ?? { n: 0, hit3: 0 };
      by[k] = e;
      e.n++;
      if (rank <= 3) e.hit3++;
    }
    tops.push(scored[0]?.score ?? 0);
    gaps.push((scored.find((s) => s.id === q.expect)?.score ?? 0) - (scored[3]?.score ?? 0));
    if (rank > 1) misses.push(`${q.id} rank ${rank}: ${q.q}`);
  }
  const n = fixture.queries.length;
  console.log(`hit@1 ${r1}/${n}  hit@3 ${r3}/${n}  hit@5 ${r5}/${n}  MRR ${(mrr / n).toFixed(3)}`);
  for (const [k, e] of Object.entries(by)) console.log(`  ${k}: hit@3 ${e.hit3}/${e.n}`);
  console.log(
    `top-1 similarity: min ${Math.min(...tops).toFixed(2)}, max ${Math.max(...tops).toFixed(2)}`,
  );
  for (const m of misses) console.log(`  miss ${m}`);

  t = performance.now();
  for (let i = 0; i < 5; i++) await embedder.embedQuery(fixture.queries[i]?.q ?? "test");
  console.log(`query latency: ${((performance.now() - t) / 5).toFixed(0)} ms`);
  await embedder.close();
}
