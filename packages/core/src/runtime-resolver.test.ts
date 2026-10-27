import type { MetadataConfig } from "@citegeist/metadata";
import type { Actor } from "@citegeist/schema";
import { afterEach, describe, expect, it, vi } from "vitest";

const configs = vi.hoisted(() => [] as MetadataConfig[]);

vi.mock("@citegeist/metadata", async (importOriginal) => {
  const original = await importOriginal<typeof import("@citegeist/metadata")>();
  return {
    ...original,
    createResolver: (options: Parameters<typeof original.createResolver>[0] = {}) => {
      configs.push({ ...(options.config ?? {}) });
      return original.createResolver(options);
    },
  };
});

import { createStubWorker } from "./ingest/worker.js";
import { Library } from "./library.js";
import { createRuntime, type Runtime } from "./runtime.js";
import { InMemoryKeychain } from "./settings/index.js";
import { cleanTmpDirs, tmpDir } from "./test-helpers.js";

const human = { actor: "human" as Actor };
const open: Array<{ lib: Library; rt: Runtime }> = [];

afterEach(async () => {
  for (const { lib, rt } of open.splice(0)) {
    await rt.close();
    await lib.close();
  }
  configs.length = 0;
  cleanTmpDirs();
});

async function setup(keychain = new InMemoryKeychain()) {
  const lib = await Library.init(tmpDir("cg-rt-"), {
    watch: false,
    localBase: tmpDir("cg-local-"),
  });
  const rt = createRuntime(lib, {
    worker: createStubWorker(),
    autoStart: false,
    settings: { keychain },
  });
  open.push({ lib, rt });
  const call = <T>(name: string, input: unknown) =>
    rt.registry.call(name, human, input) as Promise<T>;
  return { rt, call, keychain };
}

const last = (): MetadataConfig => configs.at(-1) as MetadataConfig;
const settled = () => new Promise((resolve) => setTimeout(resolve, 20));

describe("resolver settings", () => {
  it("starts without addresses or keys", async () => {
    await setup();
    await settled();
    expect(last()).toEqual({});
  });

  it("passes the contact address, the Unpaywall address and the NCBI tool to the resolver", async () => {
    const s = await setup();
    await s.call("settings.update", {
      patch: {
        mailto: "me@example.org",
        unpaywallEmail: "oa@example.org",
        ncbiTool: "my-library",
      },
    });
    expect(last()).toEqual({
      mailto: "me@example.org",
      unpaywallEmail: "oa@example.org",
      ncbiTool: "my-library",
    });
    const got = await s.call<{
      settings: { mailto?: string; unpaywallEmail?: string; ncbiTool?: string };
    }>("settings.get", {});
    expect(got.settings).toMatchObject({
      mailto: "me@example.org",
      unpaywallEmail: "oa@example.org",
      ncbiTool: "my-library",
    });

    // an empty value clears the setting again
    await s.call("settings.update", { patch: { unpaywallEmail: "", ncbiTool: "" } });
    expect(last()).toEqual({ mailto: "me@example.org" });
  });

  it("reads the NCBI key from the Keychain when it is stored and when it is removed", async () => {
    const s = await setup();
    await s.call("settings.update", {
      patch: {},
      apiKey: { provider: "ncbi", key: "ncbi-key-0123456789abcdef" },
    });
    await settled();
    expect(last().ncbiApiKey).toBe("ncbi-key-0123456789abcdef");
    const got = await s.call<{ settings: { ai: { apiKeys: Record<string, boolean> } } }>(
      "settings.get",
      {},
    );
    expect(got.settings.ai.apiKeys.ncbi).toBe(true);

    await s.call("settings.update", {
      patch: { ai: { routing: { "*": "claude-code-cli" }, apiKeys: { ncbi: false } } },
    });
    await settled();
    expect(last().ncbiApiKey).toBeUndefined();
  });

  it("picks up a key that was stored before the runtime started", async () => {
    const keychain = new InMemoryKeychain();
    await keychain.set("ncbi", "stored-before-start-0123456789");
    await setup(keychain);
    await settled();
    expect(last().ncbiApiKey).toBe("stored-before-start-0123456789");
  });

  it("refuses an address that is not an email address", async () => {
    const s = await setup();
    await expect(
      s.call("settings.update", { patch: { unpaywallEmail: "not an address" } }),
    ).rejects.toThrow(/not an email address/);
  });
});

describe("the resolver the runtime hands to the pipeline", () => {
  it("forwards the open-access lookups that the full text search uses", async () => {
    // protects: full text lookup through Unpaywall and OpenAlex in the running app
    // fails_when: the facade only forwards resolve/resolveByTitle, so both lookups look absent
    // no_claim: the network answers of Unpaywall and OpenAlex are tested in @citegeist/metadata
    const { followingResolver } = await import("./runtime.js");
    const { lookup } = followingResolver({});
    expect(typeof lookup.findOpenAccess).toBe("function");
    expect(typeof lookup.findOpenAlexPdfs).toBe("function");
  });
});
