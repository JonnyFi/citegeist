import { ItemFrontmatter } from "@citegeist/schema";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { createFixtures } from "../mock/fixtures";
import { renderApp } from "../test-utils";

async function rows() {
  return await screen.findAllByTestId("item-row");
}

describe("library table", () => {
  it("lists library items and keeps inbox items out", async () => {
    renderApp("/");
    const list = await rows();
    expect(list).toHaveLength(11);
    const table = screen.getByRole("table");
    expect(
      within(table).getByText("Soziale Systeme: Grundriss einer allgemeinen Theorie"),
    ).toBeVisible();
    expect(within(table).queryByText("Custodians of the Internet")).not.toBeInTheDocument();
  });

  it("shows authors, year and status per row", async () => {
    renderApp("/");
    const luhmann = (await rows()).find((r) => r.textContent?.includes("luhmann1984soziale"));
    expect(luhmann).toBeDefined();
    expect(within(luhmann as HTMLElement).getByText("Luhmann")).toBeInTheDocument();
    expect(within(luhmann as HTMLElement).getByText("1984")).toBeInTheDocument();
    expect(within(luhmann as HTMLElement).getByText("Wird gelesen")).toBeInTheDocument();
  });

  it("narrows by reading status", async () => {
    const user = userEvent.setup();
    const { calls } = renderApp("/");
    await rows();
    await user.click(screen.getByRole("button", { name: "Wird gelesen" }));
    await waitFor(async () => expect(await rows()).toHaveLength(2));
    expect(
      calls.some(
        (c) => c.name === "items.list" && (c.input as { status?: string }).status === "reading",
      ),
    ).toBe(true);
  });

  it("narrows by project", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await rows();
    await user.click(screen.getByRole("combobox", { name: "Projekt" }));
    await user.click(await screen.findByRole("option", { name: "RAG evaluation" }));
    await waitFor(async () => expect(await rows()).toHaveLength(4));
  });

  it("reads filters from the URL", async () => {
    renderApp("/?project=phd-proposal&status=read");
    const list = await rows();
    expect(list).toHaveLength(1);
    expect(list[0]).toHaveTextContent("habermas1981theorie");
  });

  it("offers to clear filters when nothing matches", async () => {
    const user = userEvent.setup();
    renderApp("/?project=reading-group");
    expect(await screen.findByText("Keine Quelle passt zu diesen Filtern")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Filter zurücksetzen" }));
    await waitFor(async () => expect(await rows()).toHaveLength(11));
  });

  it("shows the empty state for an empty library", async () => {
    const data = createFixtures();
    data.items.clear();
    renderApp("/", data);
    expect(await screen.findByText("Deine Bibliothek ist leer")).toBeVisible();
    expect(screen.getByRole("button", { name: "Beispielquelle hinzufügen" })).toBeVisible();
  });

  it("loads further pages on demand", async () => {
    const user = userEvent.setup();
    const data = createFixtures();
    const template = data.items.get("kuhn1962structure");
    if (!template) throw new Error("fixture missing");
    for (let i = 0; i < 50; i++) {
      const citekey = `extra${String(i).padStart(3, "0")}`;
      data.items.set(citekey, {
        frontmatter: ItemFrontmatter.parse({ ...template.frontmatter, citekey }),
        note: "",
      });
    }
    renderApp("/", data);
    expect(await rows()).toHaveLength(50);
    await user.click(screen.getByRole("button", { name: "Mehr laden" }));
    await waitFor(async () => expect(await rows()).toHaveLength(61));
    expect(screen.queryByRole("button", { name: "Mehr laden" })).not.toBeInTheDocument();
  });

  it("marks an item whose import did not finish", async () => {
    const data = createFixtures();
    const broken = data.items.get("kuhn1962structure");
    if (!broken) throw new Error("fixture missing");
    broken.frontmatter = ItemFrontmatter.parse({
      ...broken.frontmatter,
      incomplete: {
        code: "CONVERT_FAILED",
        message: "no article text found",
        at: "2026-10-24T10:00:00.000Z",
      },
    });
    renderApp("/", data);
    const row = (await rows()).find((r) => r.textContent?.includes("kuhn1962structure"));
    const stamp = within(row as HTMLElement).getByText("unvollständig");
    expect(stamp).toBeVisible();
    expect(stamp.closest("[title]")).toHaveAttribute(
      "title",
      "CONVERT_FAILED: no article text found",
    );
    const other = (await rows()).find((r) => r.textContent?.includes("lewis2020retrieval"));
    expect(within(other as HTMLElement).queryByText("unvollständig")).toBeNull();
  });

  it("opens an item from its row", async () => {
    const user = userEvent.setup();
    renderApp("/");
    const row = (await rows()).find((r) => r.textContent?.includes("lewis2020retrieval"));
    await user.click(row as HTMLElement);
    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: /Retrieval-Augmented Generation/,
      }),
    ).toBeVisible();
  });
});

describe("library sorting", () => {
  /** The sortable header of a column (the narrow status icon column has no button). */
  const header = (name: string) => {
    const found = screen
      .getAllByRole("columnheader", { name: new RegExp(name) })
      .find((h) => within(h).queryByRole("button"));
    if (!found) throw new Error(`no sortable header ${name}`);
    return found;
  };
  const order = async () =>
    (await rows()).map((r) => r.querySelector("span.font-mono")?.textContent ?? "");
  const lastListCall = (calls: Array<{ name: string; input: unknown }>) =>
    calls
      .filter((c) => c.name === "items.list" && (c.input as { inbox?: boolean }).inbox === false)
      .at(-1)?.input as { sort?: string; order?: string; inbox?: boolean };

  /** Library items with distinct days added, so that "newest first" has a visible effect. */
  function datedFixtures() {
    const data = createFixtures();
    let day = 1;
    for (const item of data.items.values()) {
      item.frontmatter = ItemFrontmatter.parse({
        ...item.frontmatter,
        created: { at: `2026-10-${String(day++).padStart(2, "0")}T10:00:00.000Z`, by: "human" },
      });
    }
    return data;
  }

  it("starts with date added, newest first, and says so in aria-sort", async () => {
    const data = datedFixtures();
    const { calls } = renderApp("/", data);
    await rows();
    expect(lastListCall(calls)).toMatchObject({ sort: "added", order: "desc", inbox: false });
    expect(header("Hinzugefügt")).toHaveAttribute("aria-sort", "descending");
    expect(header("Titel")).toHaveAttribute("aria-sort", "none");
    const keys = await order();
    const created = keys.map((k) => data.items.get(k)?.frontmatter.created.at ?? "");
    expect(created).toEqual([...created].sort().reverse());
  });

  it("sorts by title when its header is clicked and turns the order on a second click", async () => {
    const user = userEvent.setup();
    const { calls } = renderApp("/", datedFixtures());
    await rows();
    await user.click(within(header("Titel")).getByRole("button"));
    await waitFor(() => expect(header("Titel")).toHaveAttribute("aria-sort", "ascending"));
    expect(lastListCall(calls)).toMatchObject({ sort: "title", order: "asc" });
    await waitFor(async () => expect((await order())[0]).toBe("bush1945think"));
    expect((await order()).at(-1)).toBe("habermas1981theorie");
    expect(header("Hinzugefügt")).toHaveAttribute("aria-sort", "none");

    await user.click(within(header("Titel")).getByRole("button"));
    await waitFor(() => expect(header("Titel")).toHaveAttribute("aria-sort", "descending"));
    await waitFor(async () => expect((await order())[0]).toBe("habermas1981theorie"));
    expect(lastListCall(calls)).toMatchObject({ sort: "title", order: "desc" });
  });

  it("sorts every column: authors, year, type, status and date added", async () => {
    const user = userEvent.setup();
    const { calls } = renderApp("/", datedFixtures());
    await rows();
    for (const [name, sort] of [
      ["Autoren", "authors"],
      ["Jahr", "year"],
      ["Typ", "type"],
      ["Status", "status"],
      ["Hinzugefügt", "added"],
    ] as const) {
      await user.click(within(header(name)).getByRole("button"));
      // the date view was loaded at the start and comes from the cache
      if (sort !== "added") {
        await waitFor(() => expect(lastListCall(calls)).toMatchObject({ sort }));
      }
      // a column starts A to Z, the date starts with the newest
      await waitFor(() =>
        expect(header(name)).toHaveAttribute(
          "aria-sort",
          sort === "added" ? "descending" : "ascending",
        ),
      );
    }
    // another click on the active date column flips newest first to oldest first
    await user.click(within(header("Hinzugefügt")).getByRole("button"));
    await waitFor(() => expect(lastListCall(calls)).toMatchObject({ sort: "added", order: "asc" }));
  });

  it("orders authors by family name and puts the oldest year first", async () => {
    const user = userEvent.setup();
    renderApp("/", datedFixtures());
    await rows();
    await user.click(within(header("Autoren")).getByRole("button"));
    await waitFor(async () => expect((await order())[0]).toBe("ahrens2017how"));
    await user.click(within(header("Jahr")).getByRole("button"));
    await waitFor(async () => expect((await order())[0]).toBe("bush1945think"));
  });

  it("works from the keyboard", async () => {
    const user = userEvent.setup();
    renderApp("/", datedFixtures());
    await rows();
    const button = within(header("Jahr")).getByRole("button");
    button.focus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(header("Jahr")).toHaveAttribute("aria-sort", "ascending"));
    // the header button stays in the page and keeps focus while the sorted rows load
    expect(within(header("Jahr")).getByRole("button")).toHaveFocus();
    await user.keyboard(" ");
    await waitFor(() => expect(header("Jahr")).toHaveAttribute("aria-sort", "descending"));
  });

  it("keeps the chosen sort for the next start", async () => {
    const user = userEvent.setup();
    const first = renderApp("/", datedFixtures());
    await rows();
    await user.click(within(header("Jahr")).getByRole("button"));
    await waitFor(() => expect(header("Jahr")).toHaveAttribute("aria-sort", "ascending"));
    expect(JSON.parse(localStorage.getItem("citegeist.librarySort") ?? "null")).toEqual({
      sort: "year",
      order: "asc",
    });
    first.unmount();

    const { calls } = renderApp("/", datedFixtures());
    await rows();
    expect(lastListCall(calls)).toMatchObject({ sort: "year", order: "asc" });
    expect(header("Jahr")).toHaveAttribute("aria-sort", "ascending");
  });

  it("falls back to date added when the stored sort is unreadable", async () => {
    localStorage.setItem("citegeist.librarySort", '{"sort":"nonsense","order":"up"}');
    const { calls } = renderApp("/", datedFixtures());
    await rows();
    expect(lastListCall(calls)).toMatchObject({ sort: "added", order: "desc" });
  });

  it("sorts the whole library, so the second page continues the sorted view", async () => {
    const user = userEvent.setup();
    const data = createFixtures();
    const template = data.items.get("kuhn1962structure");
    if (!template) throw new Error("fixture missing");
    // 60 more items whose citekey order is the reverse of their title order
    for (let i = 0; i < 60; i++) {
      const citekey = `extra${String(59 - i).padStart(3, "0")}`;
      data.items.set(citekey, {
        frontmatter: ItemFrontmatter.parse({
          ...template.frontmatter,
          citekey,
          title: `Zz title ${String(i).padStart(3, "0")}`,
        }),
        note: "",
      });
    }
    renderApp("/", data);
    await rows();
    await user.click(within(header("Titel")).getByRole("button"));
    await waitFor(async () => expect((await rows()).length).toBe(50));
    await waitFor(async () => expect((await order())[0]).toBe("bush1945think"));
    await user.click(screen.getByRole("button", { name: "Mehr laden" }));
    await waitFor(async () => expect((await rows()).length).toBe(71));
    const titles = (await rows()).map((r) => within(r).getAllByRole("link")[0]?.textContent ?? "");
    const collator = new Intl.Collator(["de", "en"], { sensitivity: "base", numeric: true });
    expect(titles).toEqual([...titles].sort(collator.compare));
  });

  it("sorts the reading list of a project with the same choice", async () => {
    const user = userEvent.setup();
    const { calls } = renderApp("/projects/rag-evaluation?tab=list", datedFixtures());
    await screen.findAllByTestId("item-row");
    await user.click(within(header("Titel")).getByRole("button"));
    await waitFor(() =>
      expect(calls.filter((c) => c.name === "items.list").at(-1)?.input).toMatchObject({
        project: "rag-evaluation",
        sort: "title",
        order: "asc",
      }),
    );
  });
});
