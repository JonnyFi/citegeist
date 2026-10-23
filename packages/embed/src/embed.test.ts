import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createFakeEmbedder,
  DEFAULT_MODEL,
  dot,
  l2normalize,
  MODELS,
  TransformersEmbedder,
} from "./index.js";
import { poolEmbeddings } from "./transformers.js";

describe("FakeEmbedder", () => {
  it("is deterministic and returns unit vectors of the requested size", async () => {
    const a = createFakeEmbedder({ dimensions: 32 });
    const b = createFakeEmbedder({ dimensions: 32 });
    const [v1] = await a.embedDocuments(["Soziale Systeme bestehen aus Kommunikation"]);
    const [v2] = await b.embedDocuments(["Soziale Systeme bestehen aus Kommunikation"]);
    expect(v1).toEqual(v2);
    expect(v1).toHaveLength(32);
    expect(dot(v1 as Float32Array, v1 as Float32Array)).toBeCloseTo(1, 5);
  });

  it("puts texts with shared words closer than unrelated ones", async () => {
    const e = createFakeEmbedder();
    const [a, b, c] = await e.embedDocuments([
      "Die Hanse organisierte den Handel zwischen Nord- und Ostsee",
      "Handel in der Hanse",
      "Fruchtfolgen erhalten den Humusgehalt",
    ]);
    expect(dot(a as Float32Array, b as Float32Array)).toBeGreaterThan(
      dot(a as Float32Array, c as Float32Array),
    );
  });

  it("treats synonyms as the same word and counts its work", async () => {
    const e = createFakeEmbedder({ synonyms: { automobil: "wagen" } });
    const q = await e.embedQuery("Automobil");
    const [d] = await e.embedDocuments(["Wagen"]);
    expect(dot(q, d as Float32Array)).toBeCloseTo(1, 5);
    expect(e.calls).toBe(2);
    expect(e.texts).toEqual(["Automobil", "Wagen"]);
  });

  it("gives different ids to different sizes and versions", () => {
    const ids = new Set([
      createFakeEmbedder().id,
      createFakeEmbedder({ dimensions: 32 }).id,
      createFakeEmbedder({ version: "2" }).id,
    ]);
    expect(ids.size).toBe(3);
  });

  it("honours an aborted signal", async () => {
    const c = new AbortController();
    c.abort();
    await expect(createFakeEmbedder().embedQuery("x", { signal: c.signal })).rejects.toThrow();
  });

  it("returns an all-zero vector for text without words", async () => {
    const [v] = await createFakeEmbedder().embedDocuments(["..."]);
    expect(Array.from(v as Float32Array).every((x) => x === 0)).toBe(true);
  });
});

describe("model specs", () => {
  it("pin a full commit hash and stay below the native size", () => {
    for (const spec of Object.values(MODELS)) {
      expect(spec.revision).toMatch(/^[0-9a-f]{40}$/);
      expect(spec.dimensions).toBeLessThanOrEqual(spec.nativeDimensions);
      expect(spec.dtype).toBe("q8");
    }
    expect(Object.values(MODELS)).toContain(DEFAULT_MODEL);
  });
});

describe("TransformersEmbedder", () => {
  it("builds its id from model, revision, quantization and size without loading anything", () => {
    const dir = mkdtempSync(join(tmpdir(), "cg-embed-"));
    try {
      const e = new TransformersEmbedder({ modelsDir: dir });
      expect(e.id).toBe(
        `${DEFAULT_MODEL.key}@${DEFAULT_MODEL.revision.slice(0, 8)}:q8:${DEFAULT_MODEL.dimensions}`,
      );
      expect(e.dimensions).toBe(DEFAULT_MODEL.dimensions);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses to download when only local files are allowed", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cg-embed-"));
    try {
      const e = new TransformersEmbedder({ modelsDir: dir, localFilesOnly: true });
      await expect(e.embedQuery("hallo")).rejects.toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("poolEmbeddings", () => {
  const qwen = {
    ...(MODELS["qwen3-embedding-0.6b"] as never as typeof DEFAULT_MODEL),
    dimensions: 2,
  };
  const gemma = { ...DEFAULT_MODEL, dimensions: 2 };

  it("takes the last real token for decoder models, with left or right padding", () => {
    // batch of 2, sequence of 3, hidden size 3
    const data = [
      // item 0, left padded: pad, a, b -> last real token is position 2
      0, 0, 0, 1, 0, 0, 3, 4, 9,
      // item 1, right padded: c, d, pad -> last real token is position 1
      9, 9, 9, 0, 5, 12, 0, 0, 0,
    ];
    const out = poolEmbeddings(
      qwen,
      { last_hidden_state: { dims: [2, 3, 3], data } },
      { dims: [2, 3], data: [0, 1, 1, 1, 1, 0] },
      2,
    );
    expect(Array.from(out[0] as Float32Array)).toEqual([0.6000000238418579, 0.800000011920929]);
    expect(out[1]?.[0]).toBeCloseTo(0, 5);
    expect(out[1]?.[1]).toBeCloseTo(1, 5);
  });

  it("cuts sentence embeddings to the stored size and normalizes", () => {
    const out = poolEmbeddings(
      gemma,
      { sentence_embedding: { dims: [1, 4], data: [3, 4, 100, 100] } },
      { dims: [1, 1], data: [1] },
      1,
    );
    expect(out[0]?.[0]).toBeCloseTo(0.6, 5);
    expect(out[0]?.[1]).toBeCloseTo(0.8, 5);
  });

  it("fails clearly when the output has the wrong shape", () => {
    expect(() => poolEmbeddings(gemma, {}, { dims: [1, 1], data: [1] }, 1)).toThrow(
      /sentence_embedding/,
    );
  });
});

describe("l2normalize", () => {
  it("leaves a zero vector alone", () => {
    expect(Array.from(l2normalize(new Float32Array(3)))).toEqual([0, 0, 0]);
  });
});

// The real models: opt in with CITEGEIST_REAL_MODELS=1 (downloads several hundred MB).
describe.skipIf(!process.env.CITEGEIST_REAL_MODELS)("real model", () => {
  it("embeds German and English text in the same space", async () => {
    const dir = process.env.CITEGEIST_EVAL_DIR ?? join(tmpdir(), "cg-embed-real");
    const e = new TransformersEmbedder({ modelsDir: dir });
    const [de, other] = await e.embedDocuments([
      "Soziale Systeme bestehen aus Kommunikation.",
      "Gemüse wächst im Garten.",
    ]);
    const q = await e.embedQuery("social systems consist of communication");
    expect(dot(q, de as Float32Array)).toBeGreaterThan(dot(q, other as Float32Array));
    await e.close();
  }, 600_000);
});
