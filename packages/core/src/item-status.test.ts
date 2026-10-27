import { readFileSync } from "node:fs";
import { localDateOf } from "@citegeist/schema";
import { afterEach, describe, expect, it } from "vitest";
import { createTestEnv, type TestEnv } from "./ingest/testing.js";
import { cleanTmpDirs, itemData } from "./test-helpers.js";

// the test environment's clock stands at 2026-10-23T12:00:00Z
const TODAY = localDateOf(new Date("2026-10-23T12:00:00Z"));

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
  e.lib.writeItem(itemData("a1xx", { created: { at: "2026-10-01T10:00:00.000Z", by: "human" } }));
  e.lib.writeItem(itemData("b2xx", { created: { at: "2026-10-02T10:00:00.000Z", by: "human" } }));
  e.lib.writeItem(
    itemData("c3xx", {
      status: "read",
      read_at: "2026-09-01",
      created: { at: "2026-10-03T10:00:00.000Z", by: "human" },
    }),
  );
  e.lib.writeItem(itemData("d4xx", { created: { at: "2026-10-04T10:00:00.000Z", by: "human" } }));
  return e;
}

const fm = (e: TestEnv, citekey: string) => e.lib.getItem(citekey).frontmatter;
const file = (e: TestEnv, citekey: string) => readFileSync(e.lib.getItem(citekey).path, "utf8");

describe("items.setStatus", () => {
  it("marks several items as read in one call and stores the date", async () => {
    const e = await env();
    const out = await e.call("items.setStatus", {
      citekeys: ["a1xx", "b2xx", "c3xx"],
      status: "read",
    });
    expect(out).toEqual({ changed: ["a1xx", "b2xx"], unchanged: ["c3xx"] });
    expect(fm(e, "a1xx")).toMatchObject({ status: "read", read_at: TODAY });
    expect(file(e, "b2xx")).toContain(`read_at: ${TODAY}`);
    // already read: the date of the first time stays
    expect(fm(e, "c3xx").read_at).toBe("2026-09-01");
  });

  it("does not store a date for reading and removes it for unread", async () => {
    const e = await env();
    await e.call("items.setStatus", { citekeys: ["a1xx"], status: "reading" });
    expect(fm(e, "a1xx")).toMatchObject({ status: "reading" });
    expect(fm(e, "a1xx").read_at).toBeUndefined();
    await e.call("items.setStatus", { citekeys: ["c3xx"], status: "unread" });
    expect(fm(e, "c3xx").status).toBe("unread");
    expect(fm(e, "c3xx").read_at).toBeUndefined();
    expect(file(e, "c3xx")).not.toContain("read_at");
  });

  it("keeps the date when a read item goes back to reading and moves it on the next finish", async () => {
    const e = await env();
    await e.call("items.setStatus", { citekeys: ["c3xx"], status: "reading" });
    expect(fm(e, "c3xx")).toMatchObject({ status: "reading", read_at: "2026-09-01" });
    await e.call("items.setStatus", { citekeys: ["c3xx"], status: "read" });
    expect(fm(e, "c3xx")).toMatchObject({ status: "read", read_at: TODAY });
  });

  it("can be repeated and leaves a status that is set already alone", async () => {
    const e = await env();
    await e.call("items.setStatus", { citekeys: ["a1xx"], status: "read" });
    const again = await e.call("items.setStatus", { citekeys: ["a1xx", "a1xx"], status: "read" });
    expect(again).toEqual({ changed: [], unchanged: ["a1xx"] });
  });

  it("changes only the items whose status is in from", async () => {
    const e = await env();
    await e.call("items.setStatus", { citekeys: ["b2xx"], status: "read" });
    const out = await e.call("items.setStatus", {
      citekeys: ["a1xx", "b2xx", "c3xx"],
      status: "reading",
      from: ["unread"],
    });
    expect(out).toEqual({ changed: ["a1xx"], unchanged: ["b2xx", "c3xx"] });
    expect(fm(e, "b2xx").status).toBe("read");
    expect(fm(e, "c3xx").status).toBe("read");
  });

  it("fails before the first write when one citekey is unknown", async () => {
    const e = await env();
    await expect(
      e.call("items.setStatus", { citekeys: ["a1xx", "missing9999"], status: "read" }),
    ).rejects.toMatchObject({ detail: { code: "ITEM_NOT_FOUND" } });
    expect(fm(e, "a1xx").status).toBe("unread");
  });

  it("rejects a status that does not exist", async () => {
    const e = await env();
    await expect(
      e.call("items.setStatus", { citekeys: ["a1xx"], status: "done" }),
    ).rejects.toThrow();
  });
});

describe("items.update with a status", () => {
  it("keeps read_at in step with the status", async () => {
    const e = await env();
    await e.call("items.update", { citekey: "a1xx", patch: { status: "read" } });
    expect(fm(e, "a1xx")).toMatchObject({ status: "read", read_at: TODAY });
    await e.call("items.update", { citekey: "a1xx", patch: { status: "unread" } });
    expect(fm(e, "a1xx").read_at).toBeUndefined();
  });

  it("takes a read_at that the patch sets itself, and refuses a malformed one", async () => {
    const e = await env();
    await e.call("items.update", {
      citekey: "a1xx",
      patch: { status: "read", read_at: "2026-08-15" },
    });
    expect(fm(e, "a1xx").read_at).toBe("2026-08-15");
    await expect(
      e.call("items.update", { citekey: "a1xx", patch: { read_at: "yesterday" } }),
    ).rejects.toMatchObject({ detail: { code: "INVALID_PATCH" } });
  });

  it("does not turn the read date into field provenance", async () => {
    const e = await env();
    await e.call("items.update", { citekey: "a1xx", patch: { status: "read" } });
    expect(fm(e, "a1xx").provenance).not.toHaveProperty("read_at");
  });
});

describe("items.list by read date", () => {
  async function marked(e: TestEnv) {
    await e.call("items.update", {
      citekey: "a1xx",
      patch: { status: "read", read_at: "2026-10-05" },
    });
    await e.call("items.update", {
      citekey: "b2xx",
      patch: { status: "read", read_at: "2026-10-20" },
    });
  }
  const order = async (e: TestEnv, input: object, limit = 50) => {
    const keys: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await e.call<{ items: { citekey: string }[]; next?: string }>("items.list", {
        sort: "readAt",
        limit,
        ...input,
        ...(cursor ? { cursor } : {}),
      });
      keys.push(...page.items.map((i) => i.citekey));
      cursor = page.next;
    } while (cursor);
    return keys;
  };

  it("lists the date in the summary", async () => {
    const e = await env();
    await marked(e);
    const page = await e.call<{ items: { citekey: string; readAt?: string }[] }>("items.list", {
      limit: 50,
    });
    const at = (k: string) => page.items.find((i) => i.citekey === k)?.readAt;
    expect(at("a1xx")).toBe("2026-10-05");
    expect(at("c3xx")).toBe("2026-09-01");
    expect(at("d4xx")).toBeUndefined();
  });

  it("sorts newest first by default and puts items without a date last in both directions", async () => {
    const e = await env();
    await marked(e);
    expect(await order(e, {})).toEqual(["b2xx", "a1xx", "c3xx", "d4xx"]);
    expect(await order(e, { order: "asc" })).toEqual(["c3xx", "a1xx", "b2xx", "d4xx"]);
  });

  it("continues the order across pages", async () => {
    const e = await env();
    await marked(e);
    expect(await order(e, {}, 1)).toEqual(["b2xx", "a1xx", "c3xx", "d4xx"]);
  });
});
