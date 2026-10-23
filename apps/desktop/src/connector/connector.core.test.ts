// biome-ignore-all lint/suspicious/noExplicitAny: parsed JSON of recorded requests and replies
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type CoreServer, startCoreServer } from "../core/server.js";
import { seedLibrary } from "../testing/seed.js";
import { attachConnector, type ConnectorHandle } from "./index.js";

/**
 * The recorded Connector requests against a real core: the BibLaTeX we generate has to survive
 * the importer, and the registry has to take the agent actor.
 */

let tmp: string;
let core: CoreServer;
let connector: ConnectorHandle;

function fixture(name: string) {
  return JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", `${name}.json`), "utf8"));
}

async function post(name: string) {
  const fx = fixture(name);
  const res = await fetch(`http://127.0.0.1:${connector.port}${fx.path}`, {
    method: fx.method,
    headers: fx.headers,
    body: JSON.stringify(fx.body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function call(name: string, input: unknown) {
  return core.registry.call(name, { actor: "human" }, input) as Promise<any>;
}

beforeEach(async () => {
  tmp = mkdtempSync(join(tmpdir(), "citegeist-connector-core-"));
  const library = join(tmp, "library");
  seedLibrary(library);
  core = await startCoreServer({ library, localBase: join(tmp, "local"), watch: false });
  connector = await attachConnector(core, { port: 0 });
});

afterEach(async () => {
  await connector.close();
  await core.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe("Connector against a real core", () => {
  it("saves a journal article into the library with metadata, tags and provenance", async () => {
    const res = await post("save-items-journal-article");
    expect(res.status).toBe(201);

    const list = await call("items.list", { limit: 100 });
    const added = list.items.find((i: any) => i.title === "Array programming with NumPy");
    expect(added).toBeDefined();
    expect(added.inbox).toBe(false);
    expect(added.year).toBe("2020");

    const item = await call("items.get", { citekey: added.citekey });
    const fm = item.frontmatter;
    expect(fm.DOI).toBe("10.1038/s41586-020-2649-2");
    expect(fm["container-title"]).toBe("Nature");
    expect(fm.volume).toBe("585");
    expect(fm.page).toBe("357-362");
    expect(fm.author).toEqual([
      { family: "Harris", given: "Charles R." },
      { family: "Millman", given: "K. Jarrod" },
    ]);
    expect(fm.tags).toEqual(expect.arrayContaining(["Computational science", "Software"]));
    expect(fm.created.by).toBe("agent:zotero-connector");
  });

  it("keeps special characters, an institutional editor and the date of a book intact", async () => {
    const res = await post("save-items-book");
    expect(res.status).toBe(201);
    const list = await call("items.list", { limit: 100 });
    const added = list.items.find((i: any) => i.title.startsWith("Soziale Systeme &"));
    expect(added?.title).toBe("Soziale Systeme & ihre Grenzen: 100% Theorie_Praxis");
    const { frontmatter: fm } = await call("items.get", { citekey: added.citekey });
    expect(fm.editor).toEqual([{ literal: "Deutsche Gesellschaft für Soziologie" }]);
    expect(String(fm.issued)).toBe("1984-03-05");
    expect(fm.publisher).toBe("Suhrkamp");
    expect(fm.ISBN).toBe("978-3-518-28266-3");
  });

  it("applies updateSession to the stored item", async () => {
    await post("save-items-journal-article");
    const res = await post("update-session");
    expect(res.status).toBe(200);
    const list = await call("items.list", { limit: 100 });
    const added = list.items.find((i: any) => i.title === "Array programming with NumPy");
    const { frontmatter: fm } = await call("items.get", { citekey: added.citekey });
    expect(fm.projects).toContain("phd-proposal");
    expect(fm.tags).toContain("to-read");
  });

  it("lists the library projects as targets", async () => {
    const res = await post("get-selected-collection");
    expect(res.body.targets.map((t: any) => t.id)).toEqual(["L1", "Cphd-proposal"]);
    expect(res.body.libraryName).toBe("Seed library");
  });
});
