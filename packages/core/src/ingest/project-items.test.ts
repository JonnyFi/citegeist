import { afterEach, describe, expect, it } from "vitest";
import { cleanTmpDirs, itemData } from "../test-helpers.js";
import { createTestEnv, type TestEnv } from "./testing.js";

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
  await e.call("projects.create", { slug: "phd", title: "PhD", brief: "" });
  await e.call("projects.create", { slug: "side", title: "Side", brief: "" });
  e.lib.writeItem(itemData("a1xx", { projects: ["phd"] }));
  e.lib.writeItem(itemData("b2xx"));
  e.lib.writeItem(itemData("c3xx"));
  return e;
}

const projectsOf = (e: TestEnv, citekey: string): string[] =>
  e.lib.getItem(citekey).frontmatter.projects;

describe("projects.addItems and projects.removeItems", () => {
  it("adds several items to a project and reports the ones that were in it already", async () => {
    const e = await env();
    const out = await e.call("projects.addItems", {
      slug: "phd",
      citekeys: ["a1xx", "b2xx", "c3xx"],
    });
    expect(out).toEqual({ added: ["b2xx", "c3xx"], unchanged: ["a1xx"] });
    expect(projectsOf(e, "b2xx")).toEqual(["phd"]);
    expect(e.lib.getProject("phd").items).toBe(3);
  });

  it("keeps the other projects of an item and can be repeated", async () => {
    const e = await env();
    await e.call("projects.addItems", { slug: "side", citekeys: ["a1xx"] });
    expect(projectsOf(e, "a1xx")).toEqual(["phd", "side"]);
    const again = await e.call("projects.addItems", { slug: "side", citekeys: ["a1xx", "a1xx"] });
    expect(again).toEqual({ added: [], unchanged: ["a1xx"] });
    expect(projectsOf(e, "a1xx")).toEqual(["phd", "side"]);
  });

  it("removes items from a project and leaves the item in the library", async () => {
    const e = await env();
    await e.call("projects.addItems", { slug: "side", citekeys: ["a1xx"] });
    const out = await e.call("projects.removeItems", { slug: "phd", citekeys: ["a1xx", "b2xx"] });
    expect(out).toEqual({ removed: ["a1xx"], unchanged: ["b2xx"] });
    expect(projectsOf(e, "a1xx")).toEqual(["side"]);
    expect(e.lib.getProject("phd").items).toBe(0);
    const again = await e.call("projects.removeItems", { slug: "phd", citekeys: ["a1xx"] });
    expect(again).toEqual({ removed: [], unchanged: ["a1xx"] });
  });

  it("fails with a fix text for an unknown project and changes nothing", async () => {
    const e = await env();
    await expect(
      e.call("projects.addItems", { slug: "nope", citekeys: ["b2xx"] }),
    ).rejects.toMatchObject({
      detail: { code: "PROJECT_NOT_FOUND", fix: expect.stringContaining("projects.context") },
    });
    await expect(
      e.call("projects.removeItems", { slug: "nope", citekeys: ["b2xx"] }),
    ).rejects.toMatchObject({ detail: { code: "PROJECT_NOT_FOUND" } });
    expect(projectsOf(e, "b2xx")).toEqual([]);
  });

  it("fails before the first write when one citekey is unknown", async () => {
    const e = await env();
    await expect(
      e.call("projects.addItems", { slug: "phd", citekeys: ["b2xx", "missing9999"] }),
    ).rejects.toMatchObject({ detail: { fix: expect.any(String) } });
    expect(projectsOf(e, "b2xx")).toEqual([]);
  });

  it("is used by items.add with a citekey and projects but no identifier", async () => {
    const e = await env();
    const out = await e.call<{ citekey: string; job: string; duplicateOf?: string }>(
      "items.add",
      { citekey: "b2xx", projects: ["phd", "side"] },
      "agent:claude-code",
    );
    expect(out.citekey).toBe("b2xx");
    expect(out.duplicateOf).toBeUndefined();
    expect(projectsOf(e, "b2xx")).toEqual(["phd", "side"]);
    await expect(
      e.call("items.add", { citekey: "b2xx", projects: ["nope"] }, "agent:claude-code"),
    ).rejects.toMatchObject({ detail: { code: "PROJECT_NOT_FOUND" } });
    await expect(e.call("items.add", { projects: ["phd"] })).rejects.toThrow(/identifier/);
  });
});
