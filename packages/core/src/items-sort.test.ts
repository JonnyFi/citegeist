import type { Actor } from "@citegeist/schema";
import { afterEach, describe, expect, it } from "vitest";
import { Library } from "./library.js";
import { createCoreRegistry } from "./ops.js";
import { cleanTmpDirs, itemData, tmpDir } from "./test-helpers.js";

const human = { actor: "human" as Actor };
const open: Library[] = [];

afterEach(async () => {
  for (const l of open.splice(0)) await l.close();
  cleanTmpDirs();
});

interface Spec {
  citekey: string;
  title: string;
  family?: string;
  year?: number;
  type?: string;
  status?: string;
  day: number;
  inbox?: boolean;
}

// Citekey order is a1..a8 and differs from every sorted order below.
const SPECS: Spec[] = [
  { citekey: "a1", title: "Zebra", family: "Östlund", year: 2001, day: 3, status: "read" },
  { citekey: "a2", title: "apple", family: "Zimmer", year: 1999, day: 8, status: "unread" },
  { citekey: "a3", title: "Mango", family: "Adler", year: 2010, day: 1, status: "reading" },
  { citekey: "a4", title: "Äpfel", family: "ostrom", day: 6, status: "unread" },
  { citekey: "a5", title: "Birne", family: "Meyer", year: 1984, day: 2, status: "read" },
  { citekey: "a6", title: "Item 10", year: 2005, day: 5, status: "unread" },
  { citekey: "a7", title: "Item 2", family: "Brandt", year: 2020, day: 7, status: "reading" },
  {
    citekey: "a8",
    title: "Quitte",
    family: "Çelik",
    year: 2005,
    day: 4,
    status: "unread",
    inbox: true,
  },
];

async function setup() {
  const root = tmpDir("cg-sort-");
  const localBase = tmpDir("cg-local-");
  const lib = await Library.init(root, { name: "Test", localBase, watch: false });
  open.push(lib);
  for (const s of SPECS) {
    lib.writeItem(
      itemData(s.citekey, {
        title: s.title,
        author: s.family ? [{ family: s.family, given: "X" }] : [],
        issued: s.year,
        type: s.type ?? "book",
        status: s.status ?? "unread",
        created: {
          at: `2026-10-${String(10 + s.day).padStart(2, "0")}T10:00:00.000Z`,
          by: "human",
        },
        ...(s.inbox ? { inbox: { by: "agent:x" } } : {}),
      }),
    );
  }
  const reg = createCoreRegistry(lib);
  const list = async (input: object) =>
    // these tests sort the whole scope, the inbox item a8 included
    (await reg.call("items.list", human, { includeInbox: true, ...input })) as {
      items: { citekey: string; added?: string }[];
      next?: string;
    };
  /** All pages of one sorted view, with the page size given. */
  const walk = async (input: object, limit: number) => {
    const out: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await list({ ...input, limit, ...(cursor ? { cursor } : {}) });
      out.push(...page.items.map((i) => i.citekey));
      cursor = page.next;
      pages++;
    } while (cursor && pages < 20);
    return { out, pages };
  };
  return { lib, list, walk };
}

describe("items.list sorting", () => {
  it("keeps the citekey order without sort", async () => {
    const { walk } = await setup();
    expect((await walk({}, 3)).out).toEqual(SPECS.map((s) => s.citekey));
  });

  it("sorts by date added, newest first by default, across pages", async () => {
    const { walk } = await setup();
    const byDay = [...SPECS].sort((a, b) => b.day - a.day).map((s) => s.citekey);
    const paged = await walk({ sort: "added" }, 3);
    expect(paged.pages).toBe(3);
    expect(paged.out).toEqual(byDay);
    expect((await walk({ sort: "added", order: "asc" }, 3)).out).toEqual([...byDay].reverse());
  });

  it("makes the page boundary part of the sorted order, not a sort of the page", async () => {
    const { list } = await setup();
    const page1 = await list({ sort: "title", limit: 3 });
    // the three smallest titles of the whole scope, not of the first citekeys
    expect(page1.items.map((i) => i.citekey)).toEqual(["a4", "a2", "a5"]);
    const page2 = await list({ sort: "title", limit: 3, cursor: page1.next });
    expect(page2.items.map((i) => i.citekey)).toEqual(["a7", "a6", "a3"]);
  });

  it("orders titles with a locale-aware collator: case, umlauts and numbers", async () => {
    const { walk } = await setup();
    const { out } = await walk({ sort: "title" }, 50);
    // Äpfel before apple (the umlaut counts as "a"), "Item 2" before "Item 10"
    expect(out).toEqual(["a4", "a2", "a5", "a7", "a6", "a3", "a8", "a1"]);
    expect((await walk({ sort: "title", order: "desc" }, 50)).out).toEqual([
      "a1",
      "a8",
      "a3",
      "a6",
      "a7",
      "a5",
      "a2",
      "a4",
    ]);
  });

  it("sorts authors by the family name of the first author, without case or accents", async () => {
    const { walk } = await setup();
    const asc = await walk({ sort: "authors" }, 3);
    // Adler, Brandt, Çelik, Meyer, Östlund, ostrom (ö = o, then "stl" < "str"), Zimmer; no author last
    expect(asc.out).toEqual(["a3", "a7", "a8", "a5", "a1", "a4", "a2", "a6"]);
    const desc = await walk({ sort: "authors", order: "desc" }, 3);
    // the item without an author stays last in both directions
    expect(desc.out).toEqual(["a2", "a4", "a1", "a5", "a8", "a7", "a3", "a6"]);
  });

  it("sorts years as numbers and puts a missing year last in both directions", async () => {
    const { walk } = await setup();
    expect((await walk({ sort: "year" }, 4)).out).toEqual([
      "a5",
      "a2",
      "a1",
      "a6",
      "a8",
      "a3",
      "a7",
      "a4",
    ]);
    expect((await walk({ sort: "year", order: "desc" }, 4)).out.at(-1)).toBe("a4");
  });

  it("sorts status in reading order and breaks ties by citekey", async () => {
    const { walk } = await setup();
    expect((await walk({ sort: "status" }, 3)).out).toEqual([
      "a2",
      "a4",
      "a6",
      "a8",
      "a3",
      "a7",
      "a1",
      "a5",
    ]);
  });

  it("applies filters before sorting, so a sorted view of a scope has no gaps", async () => {
    const { walk } = await setup();
    const library = await walk({ sort: "title", inbox: false }, 2);
    expect(library.out).toEqual(["a4", "a2", "a5", "a7", "a6", "a3", "a1"]);
    expect((await walk({ sort: "added", inbox: true }, 2)).out).toEqual(["a8"]);
    expect((await walk({ sort: "year", status: "read" }, 1)).out).toEqual(["a5", "a1"]);
  });

  it("leaves the inbox out of a sorted view unless the caller includes it", async () => {
    const { lib } = await setup();
    const reg = createCoreRegistry(lib);
    const keys = async (input: object) =>
      (
        (await reg.call("items.list", human, { sort: "added", limit: 50, ...input })) as {
          items: { citekey: string }[];
        }
      ).items.map((i) => i.citekey);
    expect(await keys({})).not.toContain("a8");
    expect(await keys({ includeInbox: true })).toContain("a8");
  });

  it("continues a sorted view after an item changed between two pages", async () => {
    const { lib, list } = await setup();
    const page1 = await list({ sort: "title", limit: 2 });
    expect(page1.items.map((i) => i.citekey)).toEqual(["a4", "a2"]);
    lib.writeItem(itemData("a2", { title: "apple", status: "read", issued: 1999 }));
    // the item the cursor points at moved: the next page still starts behind the cursor key
    const page2 = await list({ sort: "title", limit: 2, cursor: page1.next });
    expect(page2.items.map((i) => i.citekey)).toEqual(["a5", "a7"]);
  });

  it("reports the date added of every item", async () => {
    const { list } = await setup();
    const page = await list({ sort: "added", limit: 1 });
    expect(page.items[0]).toMatchObject({ citekey: "a2", added: "2026-10-18T10:00:00.000Z" });
  });
});
