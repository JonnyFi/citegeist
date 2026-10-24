import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MockBackend, type ProcessRunner, type RunResult, type RunSpec } from "@citegeist/ai";
import { Registry } from "@citegeist/ops";
import { afterEach, describe, expect, it } from "vitest";
import type { ConvertWorker } from "../ingest/worker.js";
import { JobQueue } from "../jobs/queue.js";
import { cleanTmpDirs, tmpDir } from "../test-helpers.js";
import { type BackendProvider, BackendRegistry } from "./backends.js";
import { InMemoryKeychain, MacKeychain } from "./keychain.js";
import { bindSettingsOperations, type SettingsDeps } from "./service.js";
import { SettingsStore } from "./store.js";

afterEach(cleanTmpDirs);

type Handler = (spec: RunSpec) => Partial<RunResult>;

function fakeRunner(handler: Handler): ProcessRunner & { calls: RunSpec[] } {
  const calls: RunSpec[] = [];
  const run = (async (spec: RunSpec) => {
    calls.push(spec);
    return { stdout: "", stderr: "", exitCode: 0, timedOut: false, ...handler(spec) };
  }) as ProcessRunner & { calls: RunSpec[] };
  run.calls = calls;
  return run;
}

const human = { actor: "human" as const };

describe("MacKeychain", () => {
  it("writes the key hex-encoded through stdin, never as an argument", async () => {
    const runner = fakeRunner(() => ({}));
    const kc = new MacKeychain({ runner });
    await kc.set("openai", 'sk-secret"key');
    const call = runner.calls[0];
    expect(call?.command).toBe("security");
    expect(call?.args).toEqual(["-i"]);
    expect(call?.stdin).toContain("add-generic-password -U -s citegeist -a openai -X ");
    expect(call?.stdin).not.toContain("sk-secret");
    expect(call?.stdin?.trim().split(" ").pop()).toBe(Buffer.from('sk-secret"key').toString("hex"));
    expect(JSON.stringify(call?.args)).not.toContain("sk-secret");
  });

  it("reads, checks and deletes; exit 44 means absent", async () => {
    const runner = fakeRunner((spec) => {
      if (spec.args.includes("-w")) return { stdout: "sk-abc\n" };
      if (spec.args[0] === "find-generic-password") return { exitCode: 44 };
      return {};
    });
    const kc = new MacKeychain({ runner });
    expect(await kc.get("openai")).toBe("sk-abc");
    expect(await kc.has("openai")).toBe(false);
    await kc.delete("openai");
    expect(runner.calls.at(-1)?.args[0]).toBe("delete-generic-password");
  });

  it("has() does not ask for the secret", async () => {
    const runner = fakeRunner(() => ({ stdout: 'keychain: "login"' }));
    expect(await new MacKeychain({ runner }).has("xai")).toBe(true);
    expect(runner.calls[0]?.args).not.toContain("-w");
  });

  it("keeps the key out of the error when security fails", async () => {
    const key = "sk-top-secret-value";
    const hex = Buffer.from(key).toString("hex");
    const runner = fakeRunner(() => ({ stderr: `security: cannot add ${hex}`, exitCode: 1 }));
    const err = (await new MacKeychain({ runner }).set("openai", key).catch((e) => e)) as Error;
    expect(String(err.message)).not.toContain(hex);
    expect(String(err.message)).not.toContain(key);
  });

  it("rejects provider names that could inject commands", async () => {
    const runner = fakeRunner(() => ({}));
    await expect(new MacKeychain({ runner }).set("x -w y", "k")).rejects.toThrow();
    expect(runner.calls).toHaveLength(0);
  });
});

describe("SettingsStore", () => {
  it("returns defaults for a missing or broken file and round-trips changes", () => {
    const dir = tmpDir();
    const store = new SettingsStore(join(dir, "settings.json"));
    expect(store.load()).toEqual({
      ai: { routing: { "*": "claude-code-cli" } },
      uiLanguage: "de",
      semantic: { enabled: false },
      connector: { enabled: false, port: 23119 },
      webhooks: { port: 47321 },
      chat: { isolated: false },
    });
    writeFileSync(join(dir, "settings.json"), "{ nope");
    expect(store.load().uiLanguage).toBe("de");
    store.save({
      ai: { routing: { "*": "codex-exec" } },
      mailto: "a@b.org",
      uiLanguage: "en",
      semantic: { enabled: true },
      connector: { enabled: true, port: 23120 },
      webhooks: { port: 47400, publicUrl: "https://mac.example.ts.net" },
      chat: { isolated: true },
    });
    expect(store.load()).toEqual({
      ai: { routing: { "*": "codex-exec" } },
      mailto: "a@b.org",
      uiLanguage: "en",
      semantic: { enabled: true },
      connector: { enabled: true, port: 23120 },
      webhooks: { port: 47400, publicUrl: "https://mac.example.ts.net" },
      chat: { isolated: true },
    });
    writeFileSync(
      join(dir, "settings.json"),
      JSON.stringify({ connector: { enabled: true, port: 80 }, semantic: { enabled: "yes" } }),
    );
    expect(store.load().connector).toEqual({ enabled: true, port: 23119 });
    expect(store.load().semantic).toEqual({ enabled: false });
  });
});

const CLAUDE_OK = (spec: RunSpec): Partial<RunResult> | undefined => {
  if (spec.args[0] === "--version") return { stdout: "2.1.307 (Claude Code)\n" };
  if (spec.args[0] === "auth") return { stdout: JSON.stringify({ loggedIn: true }) };
  return undefined;
};

describe("BackendRegistry status", () => {
  it("reports each backend with a stable detail", async () => {
    const keychain = new InMemoryKeychain();
    await keychain.set("openai", "sk-1");
    const runner = fakeRunner((spec) => {
      if (spec.command === "claude") return CLAUDE_OK(spec) ?? {};
      return { exitCode: null, spawnError: "ENOENT" };
    });
    const fetch = async () => new Response(JSON.stringify({ models: [{}, {}] }), { status: 200 });
    const reg = new BackendRegistry({ runner, keychain, fetch, find: () => undefined });
    const status = await reg.status();
    const by = Object.fromEntries(status.map((s) => [s.id, s]));
    expect(by["claude-code-cli"]).toMatchObject({ available: true, detail: "ready" });
    expect(by["codex-exec"]).toMatchObject({ available: false, detail: "not-installed" });
    expect(by.ollama).toMatchObject({ available: true, detail: "ready: 2 models" });
    expect(by.openai).toMatchObject({ kind: "api-key", available: true });
    expect(by.anthropic).toMatchObject({ available: false, detail: "no-key" });
  });

  it("tells logged out from missing and marks an unreachable Ollama", async () => {
    const runner = fakeRunner((spec) => {
      if (spec.args[0] === "--version") return { stdout: "2.1.307" };
      if (spec.args[0] === "auth") return { stdout: JSON.stringify({ loggedIn: false }) };
      if (spec.args[0] === "login") return { exitCode: 1, stdout: "Not logged in" };
      return {};
    });
    const fetch = async () => {
      throw new Error("connect ECONNREFUSED");
    };
    const reg = new BackendRegistry({
      runner,
      keychain: new InMemoryKeychain(),
      fetch,
      find: () => undefined,
    });
    const by = Object.fromEntries((await reg.status()).map((s) => [s.id, s]));
    expect(by["claude-code-cli"]?.detail).toBe("logged-out");
    expect(by["codex-exec"]?.detail).toBe("logged-out");
    expect(by.ollama?.available).toBe(false);
    expect(by.ollama?.detail).toMatch(/^unreachable/);
  });

  it("builds a key-backed backend only when the key exists", async () => {
    const keychain = new InMemoryKeychain();
    const reg = new BackendRegistry({
      runner: fakeRunner(() => ({})),
      keychain,
      find: () => undefined,
    });
    await expect(reg.get("openai")).rejects.toMatchObject({
      detail: { code: "AI_NOT_CONFIGURED" },
    });
    await expect(reg.get("nope")).rejects.toMatchObject({ detail: { code: "AI_UNKNOWN_BACKEND" } });
    await keychain.set("openai", "sk-1");
    expect((await reg.get("openai")).id).toBe("openai");
    expect((await reg.build()).map((b) => b.id)).toEqual([
      "claude-code-cli",
      "codex-exec",
      "ollama",
      "openai",
    ]);
  });
});

function fakeWorker(health: Partial<Awaited<ReturnType<ConvertWorker["health"]>>> = {}) {
  const calls: string[] = [];
  const worker: ConvertWorker = {
    async convert() {
      throw new Error("not used");
    },
    async health() {
      calls.push("health");
      return { version: "0.1.0", engines: { docling: "2.0" }, ready: true, ...health };
    },
    async close() {
      calls.push("close");
    },
  };
  return { worker, calls };
}

function setup(over: Partial<SettingsDeps> = {}) {
  const dir = tmpDir();
  const sourceDir = join(dir, "convert");
  mkdirSync(sourceDir, { recursive: true });
  writeFileSync(join(sourceDir, "pyproject.toml"), "[project]\nname='x'\n");
  const envDir = join(dir, "worker", "venv");
  const queue = new JobQueue({ dbPath: join(dir, "state.sqlite") });
  const keychain = new InMemoryKeychain();
  const mock = new MockBackend(
    {
      "card.paraphrase": {
        paraphrase: "Systems consist of communication.",
        kind: "finding",
      },
    },
    "claude-code-cli",
  );
  const backends: BackendProvider = {
    get: async (id) => {
      if (id !== "claude-code-cli") throw new Error(`no backend ${id}`);
      return mock;
    },
    status: async () => [],
    build: async () => [mock],
  };
  const w = fakeWorker();
  const changes: unknown[] = [];
  const deps: SettingsDeps = {
    store: new SettingsStore(join(dir, "settings.json")),
    keychain,
    backends,
    queue,
    worker: w.worker,
    workerConfig: { sourceDir, envDir, uv: "uv" },
    runner: fakeRunner(() => ({})),
    onChange: (s) => changes.push(s),
    ...over,
  };
  const registry = new Registry();
  const svc = bindSettingsOperations(registry, deps);
  queue.start();
  return {
    registry,
    svc,
    deps,
    queue,
    keychain,
    envDir,
    sourceDir,
    workerCalls: w.calls,
    changes,
    mock,
  };
}

describe("settings operations", () => {
  it("settings.get returns defaults, key flags, backends and worker status", async () => {
    const t = setup({
      backends: {
        get: async () => {
          throw new Error("unused");
        },
        status: async () => [
          {
            id: "claude-code-cli",
            kind: "subscription-cli",
            label: "Claude Code CLI",
            available: true,
          },
        ],
        build: async () => [],
      },
    });
    await t.keychain.set("xai", "xai-key-12345678");
    const out = (await t.registry.call("settings.get", human, {})) as {
      settings: { ai: { routing: object; apiKeys: Record<string, boolean> }; uiLanguage: string };
      backends: unknown[];
      worker: { ready: boolean; detail: string };
    };
    expect(out.settings.ai.routing).toEqual({ "*": "claude-code-cli" });
    expect(out.settings.ai.apiKeys).toMatchObject({ xai: true, openai: false });
    expect(out.settings.uiLanguage).toBe("de");
    expect(out.backends).toHaveLength(1);
    expect(out.worker).toMatchObject({ ready: false, detail: "not-installed" });
    expect(JSON.stringify(out)).not.toContain("xai-key-12345678");
    await t.queue.close();
  });

  it("settings.update keeps untouched fields, stores keys in the keychain and reports onChange", async () => {
    const t = setup();
    await t.registry.call("settings.update", human, { patch: { uiLanguage: "en" } });
    const r = (await t.registry.call("settings.update", human, {
      patch: { mailto: "me@example.org" },
      apiKey: { provider: "openai", key: "sk-live-abcdefgh" },
    })) as {
      settings: { uiLanguage: string; mailto: string; ai: { apiKeys: Record<string, boolean> } };
    };
    expect(r.settings.uiLanguage).toBe("en");
    expect(r.settings.mailto).toBe("me@example.org");
    expect(r.settings.ai.apiKeys.openai).toBe(true);
    expect(await t.keychain.get("openai")).toBe("sk-live-abcdefgh");
    expect(JSON.stringify(r)).not.toContain("sk-live");
    expect(JSON.stringify(t.deps.store.load())).not.toContain("sk-live");
    expect(t.changes).toHaveLength(2);

    await t.registry.call("settings.update", human, { patch: { mailto: "" } });
    expect(t.deps.store.load().mailto).toBeUndefined();
    await t.registry.call("settings.update", human, {
      patch: { ai: { routing: { "*": "claude-code-cli" }, apiKeys: { openai: false } } },
    });
    expect(await t.keychain.has("openai")).toBe(false);
    await t.queue.close();
  });

  it("keeps chat agents out of the sandbox until the isolated switch is turned on", async () => {
    const t = setup();
    const read = async () =>
      (
        (await t.registry.call("settings.get", human, {})) as {
          settings: { chat: { isolated: boolean } };
        }
      ).settings.chat.isolated;
    expect(await read()).toBe(false);
    await t.registry.call("settings.update", human, { patch: { chat: { isolated: true } } });
    expect(await read()).toBe(true);
    await t.registry.call("settings.update", human, { patch: { uiLanguage: "en" } });
    expect(await read()).toBe(true);
    await t.registry.call("settings.update", human, { patch: { chat: { isolated: false } } });
    expect(await read()).toBe(false);
    await t.queue.close();
  });

  it("stores the hooks port and the public address, normalised, and rejects bad values", async () => {
    const t = setup();
    const call = (input: unknown) => t.registry.call("settings.update", human, input);
    const got = (await t.registry.call("settings.get", human, {})) as {
      settings: { webhooks: { port: number; publicUrl?: string } };
    };
    expect(got.settings.webhooks).toEqual({ port: 47321 });
    await call({
      patch: { webhooks: { port: 47400, publicUrl: " https://mac.example.ts.net/ " } },
    });
    expect(t.svc.webhooks()).toEqual({ port: 47400, publicUrl: "https://mac.example.ts.net" });
    await expect(
      call({ patch: { webhooks: { publicUrl: "mac.example.ts.net" } } }),
    ).rejects.toMatchObject({
      detail: { code: "SETTINGS_INVALID" },
    });
    await expect(call({ patch: { webhooks: { port: 80 } } })).rejects.toThrow();
    // An empty string removes the address, the port stays.
    await call({ patch: { webhooks: { publicUrl: "" } } });
    expect(t.svc.webhooks()).toEqual({ port: 47400 });
    await t.queue.close();
  });

  it("settings.update validates routing, key slots and the address", async () => {
    const t = setup();
    const call = (input: unknown) => t.registry.call("settings.update", human, input);
    await expect(
      call({ patch: { ai: { routing: { "card.paraphrase": "ollama" } } } }),
    ).rejects.toMatchObject({
      detail: { code: "SETTINGS_INVALID" },
    });
    await expect(call({ patch: { ai: { routing: { "*": "gpt-nine" } } } })).rejects.toMatchObject({
      detail: { code: "SETTINGS_INVALID" },
    });
    await expect(
      call({ patch: { ai: { routing: { "*": "ollama", "not.a.task": "ollama" } } } }),
    ).rejects.toMatchObject({
      detail: { code: "SETTINGS_INVALID" },
    });
    await expect(
      call({ patch: {}, apiKey: { provider: "mallory", key: "k" } }),
    ).rejects.toMatchObject({
      detail: { code: "SETTINGS_INVALID" },
    });
    await expect(call({ patch: { mailto: "not-an-address" } })).rejects.toMatchObject({
      detail: { code: "SETTINGS_INVALID" },
    });
    await call({
      patch: { ai: { routing: { "*": "claude-code-cli", "card.paraphrase": "ollama" } } },
    });
    expect(t.svc.routing()).toEqual({
      routing: { "*": "claude-code-cli", "card.paraphrase": "ollama" },
    });
    await t.queue.close();
  });

  it("settings.update is not reachable for agents", async () => {
    const t = setup();
    await expect(
      t.registry.call("settings.update", { actor: "agent:test" }, { patch: { uiLanguage: "en" } }),
    ).rejects.toMatchObject({ detail: { code: "FORBIDDEN_ADMIN" } });
    await t.queue.close();
  });
});

describe("ai.testBackend", () => {
  it("runs one paraphrase and returns the latency", async () => {
    const t = setup();
    const r = (await t.registry.call("ai.testBackend", human, { backend: "claude-code-cli" })) as {
      ok: boolean;
      latencyMs: number;
    };
    expect(r.ok).toBe(true);
    expect(r.latencyMs).toBeGreaterThanOrEqual(0);
    expect(t.mock.calls).toHaveLength(1);
    expect(t.mock.calls[0]?.task).toBe("card.paraphrase");
    await t.queue.close();
  });

  it("returns the agent-ready error instead of throwing", async () => {
    const failing = new MockBackend({}, "claude-code-cli");
    const t = setup({
      backends: { get: async () => failing, status: async () => [], build: async () => [] },
    });
    const r = (await t.registry.call("ai.testBackend", human, { backend: "claude-code-cli" })) as {
      ok: boolean;
      error: { code: string; message: string; fix: string };
    };
    expect(r.ok).toBe(false);
    expect(r.error.code).toBe("AI_BACKEND_FAILED");
    expect(r.error.fix.length).toBeGreaterThan(0);
    await t.queue.close();
  });

  it("works against a real Claude backend with a fake runner, and reports a logged-out CLI", async () => {
    const keychain = new InMemoryKeychain();
    let loggedIn = true;
    const runner = fakeRunner((spec) => {
      if (spec.args[0] === "--version") return { stdout: "2.1.307 (Claude Code)\n" };
      if (spec.args[0] === "auth") return { stdout: JSON.stringify({ loggedIn }) };
      return {
        stdout: JSON.stringify({
          is_error: false,
          structured_output: {
            paraphrase: "Systems consist of communication.",
            kind: "finding",
          },
        }),
      };
    });
    const backends = new BackendRegistry({ runner, keychain, find: () => undefined });
    const t = setup({ backends, keychain });
    const call = () =>
      t.registry.call("ai.testBackend", human, { backend: "claude-code-cli" }) as Promise<{
        ok: boolean;
        error?: { code: string; fix: string };
      }>;
    expect((await call()).ok).toBe(true);
    loggedIn = false;
    const bad = await call();
    expect(bad.ok).toBe(false);
    expect(bad.error?.code).toBe("AI_CLI_LOGGED_OUT");
    expect(bad.error?.fix).toContain("claude auth login");
    // the status list carries the same agent-ready error for the settings and onboarding screens
    const status = (await backends.status()).find((b) => b.id === "claude-code-cli");
    expect(status).toMatchObject({ available: false, detail: "logged-out" });
    expect(status?.error).toMatchObject({ code: "AI_CLI_LOGGED_OUT", recovery: "do-first" });
    expect(status?.error?.fix).toContain("claude auth login");
    const missing = (await t.registry.call("ai.testBackend", human, { backend: "openai" })) as {
      error: { code: string };
    };
    expect(missing.error.code).toBe("AI_NOT_CONFIGURED");
    await t.queue.close();
  });
});

describe("worker.setup", () => {
  it("checks uv, syncs into the machine-local environment, then asks health", async () => {
    const t = setup();
    const runner = fakeRunner((spec) => {
      if (spec.args[0] === "sync") mkdirSync(t.envDir, { recursive: true });
      return {};
    });
    (t.deps as { runner?: ProcessRunner }).runner = runner;
    const events: Array<{ progress: number; message?: string }> = [];
    t.queue.on("job", (j) =>
      events.push({ progress: j.progress, ...(j.message ? { message: j.message } : {}) }),
    );

    const { job } = (await t.registry.call("worker.setup", human, {})) as { job: string };
    const done = await t.queue.waitFor(job);
    expect(done.status).toBe("succeeded");
    expect(done.result).toMatchObject({ ready: true, version: "0.1.0" });
    expect(runner.calls.map((c) => c.args[0])).toEqual(["--version", "sync"]);
    const sync = runner.calls[1];
    expect(sync?.args).toEqual(["sync", "--frozen", "--project", t.sourceDir]);
    expect(sync?.env.UV_PROJECT_ENVIRONMENT).toBe(t.envDir);
    expect(t.workerCalls).toEqual(["close", "health"]);
    expect(events.map((e) => e.message)).toEqual(
      expect.arrayContaining(["Checking uv", "Installing the Python environment", "Worker ready"]),
    );
    const progress = events.map((e) => e.progress);
    expect(progress).toEqual([...progress].sort((a, b) => a - b));

    const status = (await t.registry.call("settings.get", human, {})) as {
      worker: { ready: boolean; engines: Record<string, string> };
    };
    expect(status.worker).toMatchObject({ ready: true, engines: { docling: "2.0" } });
    await t.queue.close();
  });

  it("fails with an agent-ready error when uv is missing", async () => {
    const t = setup();
    (t.deps as { runner?: ProcessRunner }).runner = fakeRunner(() => ({
      exitCode: null,
      spawnError: "ENOENT",
    }));
    const { job } = (await t.registry.call("worker.setup", human, {})) as { job: string };
    const done = await t.queue.waitFor(job);
    expect(done.status).toBe("failed");
    expect(done.error?.code).toBe("WORKER_UV_MISSING");
    expect(done.error?.message).toContain("brew install uv");
    await t.queue.close();
  });

  it("fails when uv sync fails and when the worker is not ready", async () => {
    const t = setup();
    (t.deps as { runner?: ProcessRunner }).runner = fakeRunner((spec) =>
      spec.args[0] === "sync" ? { exitCode: 1, stderr: "network unreachable" } : {},
    );
    const first = (await t.registry.call("worker.setup", human, {})) as { job: string };
    const failed = await t.queue.waitFor(first.job);
    expect(failed.error?.code).toBe("WORKER_SETUP_FAILED");
    expect(failed.error?.message).toContain("network unreachable");

    const notReady = fakeWorker({ ready: false });
    const t2 = setup({ worker: notReady.worker });
    const second = (await t2.registry.call("worker.setup", human, {})) as { job: string };
    expect((await t2.queue.waitFor(second.job)).error?.code).toBe("WORKER_NOT_READY");
    await t.queue.close();
    await t2.queue.close();
  });

  it("returns the running job instead of starting a second one, and force clears the environment", async () => {
    const t = setup();
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    (t.deps as { runner?: ProcessRunner }).runner = (async (spec: RunSpec) => {
      if (spec.args[0] === "sync") await gate;
      return { stdout: "", stderr: "", exitCode: 0, timedOut: false };
    }) as ProcessRunner;
    mkdirSync(t.envDir, { recursive: true });
    writeFileSync(join(t.envDir, "stale"), "x");
    const a = (await t.registry.call("worker.setup", human, { force: true })) as { job: string };
    const b = (await t.registry.call("worker.setup", human, {})) as { job: string };
    expect(b.job).toBe(a.job);
    const during = (await t.registry.call("settings.get", human, {})) as {
      worker: { detail: string };
    };
    expect(during.worker.detail).toBe("installing");
    release();
    await t.queue.waitFor(a.job);
    expect(existsSync(join(t.envDir, "stale"))).toBe(false);
    await t.queue.close();
  });

  it("fails clearly when the worker sources are missing", async () => {
    const t = setup({
      workerConfig: { sourceDir: "/nonexistent/convert", envDir: "/tmp/none", uv: "uv" },
    });
    const { job } = (await t.registry.call("worker.setup", human, {})) as { job: string };
    expect((await t.queue.waitFor(job)).error?.code).toBe("WORKER_SOURCE_MISSING");
    await t.queue.close();
  });
});
