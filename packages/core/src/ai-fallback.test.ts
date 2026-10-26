import { aiErrors, type InferenceBackend, MockBackend } from "@citegeist/ai";
import { parseFallbackNote } from "@citegeist/ops";
import type { Actor } from "@citegeist/schema";
import { afterEach, describe, expect, it } from "vitest";
import { createStubWorker } from "./ingest/worker.js";
import { Library } from "./library.js";
import { createRuntime, type Runtime } from "./runtime.js";
import { type BackendProvider, InMemoryKeychain } from "./settings/index.js";
import { cleanTmpDirs, itemData, itemFile, tmpDir, writeRaw } from "./test-helpers.js";

afterEach(cleanTmpDirs);

const human = { actor: "human" as Actor };
const CITEKEY = "luhmann1984soziale";
const QUOTE = "Soziale Systeme bestehen aus Kommunikationen.";
const TASK = "card.paraphrase";
const open: Array<{ lib: Library; rt: Runtime }> = [];

afterEach(async () => {
  for (const { lib, rt } of open.splice(0)) {
    await rt.close();
    await lib.close();
  }
});

function backend(id: string, fail?: () => Error): MockBackend {
  return new MockBackend(
    {
      [TASK]: () => {
        if (fail) throw fail();
        return { paraphrase: `von ${id}`, kind: "finding" };
      },
    },
    id,
  );
}

async function setup(backends: InferenceBackend[]) {
  const lib = await Library.init(tmpDir("cg-fallback-"), {
    watch: false,
    localBase: tmpDir("cg-local-"),
  });
  writeRaw(lib.root, `items/${CITEKEY}/${CITEKEY}.md`, itemFile(itemData(CITEKEY)));
  lib.sync();
  const provider: BackendProvider = {
    get: async (id) => {
      const b = backends.find((x) => x.id === id);
      if (!b) throw new Error(`no backend ${id}`);
      return b;
    },
    status: async () =>
      backends.map((b) => ({
        id: b.id,
        kind: "subscription-cli" as const,
        label: b.id,
        available: true,
      })),
    build: async () => backends,
  };
  const rt = createRuntime(lib, {
    worker: createStubWorker(),
    settings: { keychain: new InMemoryKeychain(), backends: provider },
  });
  open.push({ lib, rt });
  const call = <T>(name: string, input: unknown) =>
    rt.registry.call(name, human, input) as Promise<T>;
  const card = async () => {
    const { job } = await call<{ job: string }>("cards.create", {
      citekey: CITEKEY,
      anchor: { text: { exact: QUOTE } },
      quote: QUOTE,
    });
    return rt.ingest.queue.waitFor(job);
  };
  return { rt, call, card };
}

describe("AI backend switch in the runtime", () => {
  it("runs tasks on the backend that settings.update names as default", async () => {
    const a = backend("claude-code-cli");
    const b = backend("cursor-cli");
    const s = await setup([a, b]);
    await s.call("settings.update", { patch: { ai: { routing: { "*": "cursor-cli" } } } });
    expect((await s.card()).status).toBe("succeeded");
    expect(a.calls).toHaveLength(0);
    expect(b.calls).toHaveLength(1);
    // A per-task entry beats the default.
    await s.call("settings.update", {
      patch: { ai: { routing: { "*": "cursor-cli", [TASK]: "claude-code-cli" } } },
    });
    expect((await s.card()).status).toBe("succeeded");
    expect(a.calls).toHaveLength(1);
  });

  it("continues on the next backend when the limit is reached, and tells the job", async () => {
    const claude = backend("claude-code-cli", () =>
      aiErrors.backendFailed("claude-code-cli", TASK, "You've hit your limit · resets 3pm"),
    );
    const cursor = backend("cursor-cli");
    const s = await setup([claude, cursor]);
    await s.call("settings.update", {
      patch: { ai: { routing: { "*": "claude-code-cli" }, fallback: ["cursor-cli"] } },
    });

    const job = await s.card();
    expect(job.status).toBe("succeeded");
    expect(parseFallbackNote(job.message)).toEqual({
      from: "claude-code-cli",
      to: "cursor-cli",
      reason: "limit",
    });
    const summary = s.rt.usage.summary(1);
    expect(summary.totals).toMatchObject({ calls: 2, failed: 1 });
    expect(summary.byBackend.map((b) => [b.backend, b.calls, b.failed]).sort()).toEqual([
      ["claude-code-cli", 1, 1],
      ["cursor-cli", 1, 0],
    ]);

    // The settings screen reads the pause; the next task does not try Claude again.
    const settings = await s.call<{
      backends: Array<{ id: string; paused?: { kind: string; until: string } }>;
    }>("settings.get", {});
    const paused = settings.backends.find((b) => b.id === "claude-code-cli")?.paused;
    expect(paused?.kind).toBe("limit");
    expect(Date.parse(paused?.until ?? "")).toBeGreaterThan(Date.now());
    expect((await s.card()).status).toBe("succeeded");
    expect(claude.calls).toHaveLength(1);
    expect(cursor.calls).toHaveLength(2);
  });

  it("fails the job when the failure is about content and does not touch the next backend", async () => {
    const claude = new MockBackend({ [TASK]: { nonsense: true } }, "claude-code-cli");
    const cursor = backend("cursor-cli");
    const s = await setup([claude, cursor]);
    await s.call("settings.update", {
      patch: { ai: { routing: { "*": "claude-code-cli" }, fallback: ["cursor-cli"] } },
    });
    expect((await s.card()).status).toBe("failed");
    expect(cursor.calls).toHaveLength(0);
  });

  it("does not fall back when the user switches the fallback list off", async () => {
    const claude = backend("claude-code-cli", () =>
      aiErrors.backendFailed("claude-code-cli", TASK, "usage limit reached"),
    );
    const cursor = backend("cursor-cli");
    const s = await setup([claude, cursor]);
    await s.call("settings.update", {
      patch: { ai: { routing: { "*": "claude-code-cli" }, fallback: [] } },
    });
    expect((await s.card()).status).toBe("failed");
    expect(cursor.calls).toHaveLength(0);
  });
});
