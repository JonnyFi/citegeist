import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

// 200 synthetic selections over 3 arXiv PDFs, created through the real DOM selection API.
const DOCS: [string, number][] = [
  ['attention', 67],
  ['bert', 67],
  ['adam', 66],
];
const SEED = 20261023;

type Cfg = { perturb: string[]; norm: { ligatures?: boolean } | null; reanchor?: Record<string, unknown>; useWindow?: boolean; seed?: number };

const CORE = ['ws', 'lig', 'hyph', 'word'];
const CONFIGS: Record<string, Cfg> = {
  // criterion 1: reflow view, same conversion
  reflow: { perturb: [], norm: {} },
  // criterion 2: perturbation as specified (whitespace, ligatures, hyphenation, one word in 5 percent of paragraphs)
  'perturbed (norm-v1)': { perturb: CORE, norm: {} },
  'perturbed (norm-v1 + ligature fold)': { perturb: CORE, norm: { ligatures: true } },
  // single perturbations, norm-v1 + ligature fold
  'only ws': { perturb: ['ws'], norm: { ligatures: true } },
  'only lig (norm-v1)': { perturb: ['lig'], norm: {} },
  'only lig (+fold)': { perturb: ['lig'], norm: { ligatures: true } },
  'only hyph': { perturb: ['hyph'], norm: { ligatures: true } },
  'only word': { perturb: ['word'], norm: { ligatures: true } },
  // harsher extras beyond the spec
  'extra: spacing jitter': { perturb: ['spacing'], norm: { ligatures: true } },
  'extra: failed dehyphenation': { perturb: ['rehyph'], norm: { ligatures: true } },
  'extra: core + spacing + rehyph': { perturb: [...CORE, 'spacing', 'rehyph'], norm: { ligatures: true } },
  // stress: far beyond the spec
  'stress: 1 in 25 words changed': { perturb: ['wordDense'], norm: { ligatures: true } },
  'stress: everything incl. dense words': { perturb: [...CORE, 'spacing', 'rehyph', 'wordDense'], norm: { ligatures: true } },
  // ablations on the perturbed stream
  'ablation: no normalisation of target': { perturb: CORE, norm: null },
  'ablation: exact only (no fuzzy)': { perturb: CORE, norm: { ligatures: true }, reanchor: { disable: ['fuzzy'] } },
  'ablation: no page window': { perturb: CORE, norm: { ligatures: true }, useWindow: false },
  'ablation: no position/exact fast path': { perturb: CORE, norm: { ligatures: true }, reanchor: { disable: ['position', 'exact'] } },
  'ablation: stricter (quote>=0.9)': { perturb: CORE, norm: { ligatures: true }, reanchor: { minQuoteScore: 0.9 } },
  'ablation: looser (quote>=0.6)': { perturb: CORE, norm: { ligatures: true }, reanchor: { minQuoteScore: 0.6, minScore: 0.5 } },
};

// negative control: the selected paragraphs are deleted, the right answer is "orphan"
const NEG: Record<string, Record<string, unknown>> = {
  'default (quote>=0.75, score>=0.7)': {},
  'strict (quote>=0.9, score>=0.8)': { minQuoteScore: 0.9, minScore: 0.8 },
  'loose (quote>=0.6, score>=0.5)': { minQuoteScore: 0.6, minScore: 0.5 },
};

// other perturbation seeds for the headline number
const SEEDS = [11, 23, 37, 41, 59];

test('S3: 200 selections, reflow + perturbation + quad round trip', async ({ page }) => {
  const rows: Record<string, any[]> = {};
  const quad: any[] = [];
  const neg: Record<string, any[]> = {};
  const capture: any[] = [];
  const seeds: Record<string, any[]> = {};
  const info: any[] = [];
  const synthExact: Record<string, string> = {};
  const t0 = Date.now();

  for (const [name, n] of DOCS) {
    expect(existsSync(path.join('data', `${name}.pdf`)), 'run `npm run data` first').toBe(true);
    await page.goto(`/?pdf=${name}`);
    await page.waitForSelector('body[data-ready="1"]', { timeout: 120_000 });
    info.push(await page.evaluate(() => (document.getElementById('info') as HTMLElement).textContent));
    const synth: any[] = await page.evaluate(([n, seed]) => (window as any).spike.synthesise(n, seed), [n, SEED] as const);
    expect(synth.length).toBe(n);
    for (const s of synth) synthExact[s.id] = s.cap.text.exact;
    capture.push(...synth.map((s) => ({ id: s.id, ok: s.captureOk, quads: s.cap.pdf.quads.length })));

    for (const [label, cfg] of Object.entries(CONFIGS)) {
      const r = await page.evaluate(([items, cfg]) => (window as any).spike.evaluate(items, cfg), [synth, cfg] as const);
      (rows[label] ??= []).push(...r.map((x: any) => ({ ...x, doc: name })));
    }
    for (const seed of SEEDS) {
      const r = await page.evaluate(([items, cfg]) => (window as any).spike.evaluate(items, cfg), [synth, { perturb: CORE, norm: { ligatures: true }, seed }] as const);
      (seeds[String(seed)] ??= []).push(...r.map((x: any) => ({ ...x, doc: name })));
    }
    for (const [label, opts] of Object.entries(NEG)) {
      const r = await page.evaluate(([items, opts]) => (window as any).spike.negativeControl(items, opts), [synth, opts] as const);
      (neg[label] ??= []).push(...r.map((x: any) => ({ ...x, doc: name })));
    }
    const q = await page.evaluate((items) => (window as any).spike.quadRoundTrip(items), synth);
    quad.push(...q.map((x: any) => ({ ...x, doc: name })));
  }

  const share = (a: any[], f: (x: any) => boolean) => a.filter(f).length / a.length;
  const summary: Record<string, any> = {};
  for (const [label, r] of Object.entries(rows)) {
    summary[label] = {
      n: r.length,
      sameText: share(r, (x) => x.ok),
      orphan: share(r, (x) => !x.found),
      wrongPlace: share(r, (x) => x.wrongPlace),
      wrongPlaceNoOverlap: share(r, (x) => x.found && !x.overlaps),
      pageOk: share(r, (x) => x.pageOk),
      ambiguousFlagged: share(r, (x) => x.ambiguous),
      affected: share(r, (x) => x.got !== x.exact),
      byLength: Object.fromEntries(
        [
          ['<40', (x: any) => x.exactLen < 40],
          ['40-100', (x: any) => x.exactLen >= 40 && x.exactLen < 100],
          ['>=100', (x: any) => x.exactLen >= 100],
        ].map(([k, f]: any) => [k, { n: r.filter(f).length, sameText: share(r.filter(f), (x) => x.ok) }]),
      ),
      methods: r.reduce((m: any, x) => ((m[x.method] = (m[x.method] ?? 0) + 1), m), {}),
      perDoc: Object.fromEntries(DOCS.map(([d]) => [d, share(r.filter((x) => x.doc === d), (x) => x.ok)])),
    };
  }
  const seedSummary = Object.fromEntries(Object.entries(seeds).map(([s, r]) => [s, share(r, (x) => x.ok)]));
  const quadSummary = {
    n: quad.length,
    quadsTextMatchesQuote: share(quad, (x) => x.textOk),
    quadsLocateOnSamePage: share(quad, (x) => x.pageOk),
    quadsLocateSameSpan: share(quad, (x) => x.spanOk),
    quadsAmbiguous: share(quad, (x) => x.ambiguous),
  };
  const negSummary = Object.fromEntries(
    Object.entries(neg).map(([k, r]) => [k, { n: r.length, correctlyOrphaned: share(r, (x) => x.orphaned), falseAnchors: r.filter((x) => !x.orphaned).map((x) => ({ id: x.id, method: x.method, quoteScore: +x.quoteScore.toFixed(2), score: +x.score.toFixed(2), exact: x.exact, got: x.got })) }]),
  );
  const captureSummary = { n: capture.length, domRangeMatchesIntended: share(capture, (x) => x.ok), withQuads: share(capture, (x) => x.quads > 0) };

  const failures = {
    reflow: rows.reflow.filter((x) => !x.ok),
    perturbed: rows['perturbed (norm-v1 + ligature fold)'].filter((x) => !x.ok),
    stress: rows['stress: everything incl. dense words'].filter((x) => !x.ok),
    quad: quad.filter((x) => !x.pageOk || !x.textOk).map((x) => ({ ...x, exact: synthExact[x.id] })),
  };
  mkdirSync('results', { recursive: true });
  writeFileSync('results/results.json', JSON.stringify({ info, summary, negSummary, seedSummary, quadSummary, captureSummary, failures, seconds: (Date.now() - t0) / 1000 }, null, 1));
  console.log(JSON.stringify({ summary: Object.fromEntries(Object.entries(summary).map(([k, v]) => [k, `${(v.sameText * 100).toFixed(1)}% same, ${(v.orphan * 100).toFixed(1)}% orphan, ${(v.wrongPlace * 100).toFixed(1)}% wrong (${(v.wrongPlaceNoOverlap * 100).toFixed(1)}% no overlap), ${(v.affected * 100).toFixed(0)}% text changed, ${JSON.stringify(v.methods)}`])), seedSummary, quadSummary, captureSummary, neg: Object.fromEntries(Object.entries(negSummary).map(([k, v]: any) => [k, `${(v.correctlyOrphaned * 100).toFixed(1)}% correctly orphaned`])) }, null, 1));

  // pass criteria from docs/architecture.md (risk table)
  expect(summary.reflow.sameText).toBeGreaterThanOrEqual(0.98);
  expect(summary['perturbed (norm-v1 + ligature fold)'].sameText).toBeGreaterThanOrEqual(0.95);
});
