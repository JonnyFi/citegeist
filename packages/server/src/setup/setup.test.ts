import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryKeychain, JobQueue } from "@citegeist/core";
import { Registry } from "@citegeist/ops";
import { afterEach, describe, expect, it } from "vitest";
import { createDesktopSettingsDeps, resolveResearchSource, resolveWorkerSource } from "./index.js";

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "cg-setup-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("resolveWorkerSource", () => {
  it("prefers the override, then the packaged resources, then the repo checkout", () => {
    const has = (dirs: string[]) => (p: string) =>
      dirs.some((d) => p === join(d, "pyproject.toml"));
    expect(
      resolveWorkerSource({ override: "/x", exists: has(["/x", "/res/workers/convert"]) }),
    ).toBe("/x");
    expect(
      resolveWorkerSource({
        override: "/x",
        resourcesPath: "/res",
        exists: has(["/res/workers/convert"]),
      }),
    ).toBe("/res/workers/convert");
    expect(resolveWorkerSource({ exists: () => false })).toMatch(/workers[/\\]convert$/);
  });
});

describe("resolveResearchSource", () => {
  it("finds workers/research in the packaged resources, else falls back to the repo", () => {
    // protects: citegeist.app starts pipeline.py from Resources/workers/research
    // fails_when: the packaged path is ignored, or the override wins although it has no pipeline.py
    // no_claim: electron-builder copying the folder is not exercised; see electron-builder.yml
    const has = (dirs: string[]) => (p: string) =>
      dirs.some((d) => p === join(d, "scripts", "pipeline.py"));
    expect(
      resolveResearchSource({
        override: "/x",
        resourcesPath: "/res",
        exists: has(["/res/workers/research"]),
      }),
    ).toBe("/res/workers/research");
    expect(resolveResearchSource({ override: "/x", exists: has(["/x"]) })).toBe("/x");
    expect(resolveResearchSource({ exists: () => false })).toMatch(/workers[/\\]research$/);
  });
});

describe("createDesktopSettingsDeps", () => {
  it("binds the settings operations with files under the local base", async () => {
    const base = tmp();
    const source = join(base, "src");
    mkdirSync(source, { recursive: true });
    writeFileSync(join(source, "pyproject.toml"), "[project]\nname='x'\n");
    const queue = new JobQueue({ dbPath: join(base, "state.sqlite") });
    const { bindSettingsOperations } = await import("@citegeist/core");
    const deps = createDesktopSettingsDeps({
      localBase: base,
      queue,
      workerSource: source,
      keychain: new InMemoryKeychain(),
      runner: async () => ({
        stdout: "",
        stderr: "",
        exitCode: null,
        timedOut: false,
        spawnError: "ENOENT",
      }),
      fetch: async () => {
        throw new Error("offline");
      },
    });
    const registry = new Registry();
    bindSettingsOperations(registry, deps);
    await registry.call("settings.update", { actor: "human" }, { patch: { uiLanguage: "en" } });
    const out = (await registry.call("settings.get", { actor: "human" }, {})) as {
      settings: { uiLanguage: string };
      worker: { detail: string };
      backends: Array<{ id: string; available: boolean }>;
    };
    expect(out.settings.uiLanguage).toBe("en");
    expect(out.worker.detail).toBe("not-installed");
    expect(out.backends.find((b) => b.id === "claude-code-cli")?.available).toBe(false);
    expect(deps.workerConfig.envDir).toBe(join(base, "worker", "venv"));
    await queue.close();
  });
});
