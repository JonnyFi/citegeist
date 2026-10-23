// Port of the S3 bench (docs/spikes/s3-anchoring.md) onto synthetic fixture text:
// 200 selections over three fixture documents, anchors made on the PDF-like stream, resolved in a
// reflow stream with and without simulated re-conversion. Ground truth comes from the origin maps.
import { describe, expect, it } from "vitest";
import { createTextAnchor } from "./anchor.js";
import { type Resolved, resolveAnchor } from "./resolve.js";
import { buildStream, type TextStream } from "./stream.js";
import {
  type Fixture,
  makeFixture,
  pdfStream,
  reflowParagraphs,
  reflowUnits,
  rng,
} from "./testing/fixture.js";
import { type PerturbName, perturb } from "./testing/perturb.js";

const DOCS: [number, number][] = [
  [101, 67],
  [202, 67],
  [303, 66],
];
const CORE: PerturbName[] = ["ws", "lig", "hyph", "word"];

interface Sel {
  id: string;
  doc: number;
  anchor: NonNullable<ReturnType<typeof createTextAnchor>>;
  /** item-space range of the selection */
  rs: number;
  re: number;
  page: number;
}

function srcOf(stream: TextStream, i: number): number {
  return stream.src[i] ?? -1;
}

/** Word-aligned selections of 4 to 40 words within one page, like the S3 synthesiser. */
function synthesise(f: Fixture, stream: TextStream, doc: number, n: number, seed: number): Sel[] {
  const rand = rng(seed);
  const out: Sel[] = [];
  const text = stream.text;
  let guard = 0;
  while (out.length < n && guard++ < 20000) {
    const page = stream.pages[Math.floor(rand() * stream.pages.length)];
    if (!page) continue;
    const words = [...text.slice(page.start, page.end).matchAll(/\S+/g)];
    const len = 4 + Math.floor(rand() * 37);
    const i = Math.floor(rand() * Math.max(1, words.length - len));
    const a = words[i];
    const b = words[i + len - 1];
    if (!a || !b) continue;
    const start = page.start + (a.index ?? 0);
    const end = page.start + (b.index ?? 0) + b[0].length;
    const exact = text.slice(start, end);
    const letters = exact.match(/\p{L}/gu)?.length ?? 0;
    if (exact.length < 20 || letters / exact.length < 0.6) continue;
    const anchor = createTextAnchor(stream, start, end);
    if (!anchor) continue;
    let rs = -1;
    let re = -1;
    for (let k = start; k < end; k++) {
      const s = srcOf(stream, k);
      if (s < 0) continue;
      if (rs === -1) rs = s;
      re = s + 1;
    }
    const fu = f.furniture[page.page];
    const touches = (x: { text: string; base: number }) =>
      rs < x.base + x.text.length && re > x.base;
    if (fu && (touches(fu.header) || touches(fu.footer))) continue;
    out.push({ id: `d${doc}-${out.length}`, doc, anchor, rs, re, page: page.page });
  }
  expect(out.length).toBe(n);
  return out;
}

function truth(stream: TextStream, rs: number, re: number): { start: number; end: number } | null {
  let lo = -1;
  let hi = -1;
  for (let i = 0; i < stream.src.length; i++) {
    const s = srcOf(stream, i);
    if (s >= rs && s < re) {
      if (lo === -1) lo = i;
      hi = i;
    }
  }
  return lo === -1 ? null : { start: lo, end: hi + 1 };
}

function iou(a0: number, a1: number, b0: number, b1: number): number {
  const inter = Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
  const uni = Math.max(a1, b1) - Math.min(a0, b0);
  return uni <= 0 ? 0 : inter / uni;
}

interface Row {
  ok: boolean;
  orphan: boolean;
  wrongPlace: boolean;
  method: string;
  exactLen: number;
}

function judge(target: TextStream, s: Sel, r: Resolved): Row {
  const t = truth(target, s.rs, s.re);
  if (r.status === "orphaned") {
    return {
      ok: false,
      orphan: true,
      wrongPlace: false,
      method: "orphan",
      exactLen: s.anchor.exact.length,
    };
  }
  const ok = t !== null && iou(r.start, r.end, t.start, t.end) >= 0.8;
  const overlaps = t !== null && Math.min(r.end, t.end) > Math.max(r.start, t.start);
  return {
    ok,
    orphan: false,
    wrongPlace: !ok && !overlaps,
    method: r.method,
    exactLen: s.anchor.exact.length,
  };
}

interface Docs {
  fixtures: Fixture[];
  sels: Sel[][];
  paras: ReturnType<typeof reflowParagraphs>[];
}

function setup(): Docs {
  const fixtures = DOCS.map(([seed]) => makeFixture(seed));
  const sels = fixtures.map((f, d) =>
    synthesise(f, pdfStream(f), d, DOCS[d]?.[1] ?? 0, 20261023 + d),
  );
  return { fixtures, sels, paras: fixtures.map(reflowParagraphs) };
}

const docs = setup();

function evaluate(
  perturbs: PerturbName[],
  seed = 7,
  resolve: (target: TextStream, s: Sel) => Resolved = (target, s) =>
    resolveAnchor(target, s.anchor, { pageHint: s.page }),
): Row[] {
  const rows: Row[] = [];
  docs.sels.forEach((sels, d) => {
    const paras = docs.paras[d] ?? [];
    const ms = perturbs.length
      ? perturb(
          paras.map((p) => p.m),
          perturbs,
          seed,
        )
      : paras.map((p) => p.m);
    const target = buildStream(reflowUnits(ms.map((m, i) => ({ m, page: paras[i]?.page ?? 0 }))));
    for (const s of sels) rows.push(judge(target, s, resolve(target, s)));
  });
  return rows;
}

const share = (rows: Row[], f: (r: Row) => boolean) => rows.filter(f).length / rows.length;

describe("S3 bench: 200 selections", () => {
  it("creates 200 selections", () => {
    expect(docs.sels.flat().length).toBe(200);
  });

  it("criterion 1: same text in the reflow view, at least 98 %", () => {
    const rows = evaluate([]);
    expect(share(rows, (r) => r.ok)).toBeGreaterThanOrEqual(0.98);
  });

  it("criterion 2: same text after re-conversion, at least 95 %", () => {
    const rows = evaluate(CORE);
    expect(share(rows, (r) => r.ok)).toBeGreaterThanOrEqual(0.95);
    expect(share(rows, (r) => r.wrongPlace)).toBe(0);
  });

  it.each([11, 23, 37, 41, 59])("core perturbation, seed %i", (seed) => {
    expect(share(evaluate(CORE, seed), (r) => r.ok)).toBeGreaterThanOrEqual(0.95);
  });

  it("the position hint resolves against the stream the anchor was made on", () => {
    const rows: Row[] = [];
    docs.sels.forEach((sels, d) => {
      const fx = docs.fixtures[d];
      if (!fx) return;
      const target = pdfStream(fx);
      for (const s of sels) rows.push(judge(target, s, resolveAnchor(target, s.anchor)));
    });
    expect(share(rows, (r) => r.method === "position")).toBe(1);
  });

  it("survives extra jitter (spacing, failed dehyphenation)", () => {
    const rows = evaluate([...CORE, "spacing", "rehyph"]);
    expect(share(rows, (r) => r.ok)).toBeGreaterThanOrEqual(0.95);
  });

  it("stress run with one changed word in 25 stays above 90 %, wrong places below 2 %", () => {
    const rows = evaluate(["wordDense"]);
    expect(share(rows, (r) => r.ok)).toBeGreaterThanOrEqual(0.9);
    expect(share(rows, (r) => r.wrongPlace)).toBeLessThan(0.02);
  });

  it("ablation: exact match without fuzzy is clearly worse", () => {
    const rows = evaluate(CORE, 7, (t, s) =>
      resolveAnchor(t, s.anchor, { pageHint: s.page, disable: ["fuzzy"] }),
    );
    expect(share(rows, (r) => r.ok)).toBeLessThan(0.9);
  });

  it("ablation: without the page window the result is the same", () => {
    const rows = evaluate(CORE, 7, (t, s) => resolveAnchor(t, s.anchor, { disable: ["window"] }));
    expect(share(rows, (r) => r.ok)).toBeGreaterThanOrEqual(0.95);
  });

  it("negative control: deleted paragraphs are orphaned (98 % at 0.9/0.8)", () => {
    let orphaned = 0;
    let total = 0;
    docs.sels.forEach((sels, d) => {
      const paras = docs.paras[d] ?? [];
      for (const s of sels) {
        // delete the paragraphs that contain any part of the selection
        const keep = paras.filter((p) => !p.m.src.some((x) => x >= s.rs && x < s.re));
        const target = buildStream(reflowUnits(keep));
        const r = resolveAnchor(target, s.anchor, { pageHint: s.page });
        total++;
        if (r.status === "orphaned") orphaned++;
      }
    });
    expect(total).toBe(200);
    expect(orphaned / total).toBeGreaterThanOrEqual(0.98);
  });
});
