import { afterEach, describe, expect, it } from "vitest";
import { cleanTmpDirs } from "../test-helpers.js";
import { createTestEnv, type TestEnv } from "./testing.js";

// W5.1, L9 (Agents Rule of Two): a research job reads untrusted web pages, so the core refuses
// to open an address that the model composed. It also lands every paper in the inbox.

let envs: TestEnv[] = [];
afterEach(async () => {
  for (const e of envs) {
    await e.svc.close();
    await e.lib.close();
  }
  envs = [];
  cleanTmpDirs();
});

async function env(): Promise<TestEnv> {
  const e = await createTestEnv();
  envs.push(e);
  return e;
}

const research = { actor: "agent:research" as const, egress: "scholarly" as const };
const FORBIDDEN = { detail: { code: "RESEARCH_ADDRESS_FORBIDDEN" } };

describe("callers with the scholarly egress limit", () => {
  it("refuses a web address outside the scholarly hosts, with library content in it or not", async () => {
    const e = await env();
    for (const identifier of [
      "https://evil.example/collect?d=Notiz+der+Bibliothek",
      "https://evil.example/paper.pdf",
      "http://127.0.0.1:8080/",
      "https://doi.org.evil.example/x",
    ]) {
      await expect(
        e.registry.call("items.add", research, { identifier }),
        identifier,
      ).rejects.toMatchObject(FORBIDDEN);
    }
    expect(e.lib.listItems({ limit: 10 }).items).toEqual([]);
  });

  it("still adds a DOI, a DOI address and BibTeX, and lands them in the inbox", async () => {
    const e = await env();
    const doi = (await e.registry.call("items.add", research, {
      identifier: "10.1086/225469",
      target: "library",
      why: "relevant",
    })) as { citekey: string };
    const viaUrl = (await e.registry.call("items.add", research, {
      identifier: "https://doi.org/10.1086/225469",
    })) as { citekey: string };
    const bib = (await e.registry.call("items.add", research, {
      identifier: "@book{k, title={A book}, author={Doe, Jane}, year={2020}}",
      target: "library",
    })) as { citekey: string };
    expect(viaUrl.citekey).toBe(doi.citekey);
    const listed = e.lib.listItems({ limit: 10, inbox: true }).items.map((i) => i.citekey);
    expect(listed).toContain(doi.citekey);
    expect(listed).toContain(bib.citekey);
  });
});
