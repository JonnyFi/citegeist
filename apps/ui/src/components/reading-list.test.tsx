import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderApp } from "../test-utils";

// rag-evaluation, all added at the same time, so by citekey: ragas (unread), lewis (reading),
// beir (unread), vaswani (read)
const PATH = "/projects/rag-evaluation?tab=list";

const handle = (title: RegExp) => screen.getByRole("button", { name: title });
const stored = (data: ReturnType<typeof renderApp>["data"]) =>
  data.projects.get("rag-evaluation")?.frontmatter.reading ?? [];

/** Opens the note input of a row from its menu. */
async function addNote(user: ReturnType<typeof userEvent.setup>, row: HTMLElement) {
  await user.click(within(row).getByRole("button", { name: /^Aktionen für/ }));
  await user.click(await screen.findByRole("menuitem", { name: "Notiz hinzufügen" }));
}

describe("reading list of a project", () => {
  it("shows the items in order with the progress and opens the next text", async () => {
    const user = userEvent.setup();
    renderApp(PATH);
    await screen.findAllByTestId("item-row");
    expect(await screen.findByText("1 von 4 gelesen")).toBeVisible();
    const rows = screen.getAllByTestId("item-row");
    expect(rows).toHaveLength(4);
    expect(within(rows[0] as HTMLElement).getByText("1")).toBeVisible();
    expect(within(rows[0] as HTMLElement).getByText(/RAGAS/)).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Als Nächstes lesen" }));
    expect(await screen.findByRole("heading", { level: 1, name: /RAGAS/ })).toBeVisible();
  });

  it("moves an item with the arrow keys on its handle and keeps the focus there", async () => {
    const user = userEvent.setup();
    const { data, calls } = renderApp(PATH);
    await screen.findAllByTestId("item-row");
    handle(/^RAGAS.* verschieben/).focus();
    await user.keyboard("{ArrowDown}");
    await waitFor(() =>
      expect(calls.find((c) => c.name === "projects.moveReading")?.input).toEqual({
        slug: "rag-evaluation",
        citekey: "es2023ragas",
        position: 1,
      }),
    );
    await waitFor(() =>
      expect(
        screen.getAllByTestId("item-row").map((r) => r.textContent?.includes("RAGAS")),
      ).toEqual([false, true, false, false]),
    );
    expect(stored(data).map((e) => e.item)).toEqual([
      "lewis2020retrieval",
      "es2023ragas",
      "thakur2021beir",
      "vaswani2017attention",
    ]);
    await waitFor(() => expect(handle(/^RAGAS.* verschieben/)).toHaveFocus());
    expect(await screen.findByText(/RAGAS.* steht jetzt an Position 2 von 4/)).toBeInTheDocument();
  });

  it("does not move the first item up or the last one down", async () => {
    const user = userEvent.setup();
    const { calls } = renderApp(PATH);
    await screen.findAllByTestId("item-row");
    handle(/^RAGAS.* verschieben/).focus();
    await user.keyboard("{ArrowUp}");
    handle(/^Attention Is All You Need verschieben/).focus();
    await user.keyboard("{ArrowDown}");
    expect(calls.some((c) => c.name === "projects.moveReading")).toBe(false);
  });

  it("moves an item by dropping it on another row", async () => {
    const { calls, data } = renderApp(PATH);
    const rows = await screen.findAllByTestId("item-row");
    const grip = handle(/^Attention Is All You Need verschieben/);
    fireEvent.dragStart(grip, { dataTransfer: { setData() {}, effectAllowed: "" } });
    fireEvent.dragOver(rows[0] as HTMLElement);
    fireEvent.drop(rows[0] as HTMLElement);
    // a row without a measured height counts as the lower half: dropped after the first row
    await waitFor(() =>
      expect(calls.find((c) => c.name === "projects.moveReading")?.input).toEqual({
        slug: "rag-evaluation",
        citekey: "vaswani2017attention",
        position: 1,
      }),
    );
    await waitFor(() => expect(stored(data)[1]?.item).toBe("vaswani2017attention"));
  });

  it("moves an item from the row menu", async () => {
    const user = userEvent.setup();
    const { calls } = renderApp(PATH);
    const rows = await screen.findAllByTestId("item-row");
    await user.click(within(rows[2] as HTMLElement).getByRole("button", { name: /^Aktionen für/ }));
    await user.click(await screen.findByRole("menuitem", { name: "Nach oben" }));
    await waitFor(() =>
      expect(calls.find((c) => c.name === "projects.moveReading")?.input).toMatchObject({
        citekey: "thakur2021beir",
        position: 1,
      }),
    );
  });

  it("sets, changes and clears a note on an entry", async () => {
    const user = userEvent.setup();
    const { calls, data } = renderApp(PATH);
    const rows = await screen.findAllByTestId("item-row");
    await addNote(user, rows[1] as HTMLElement);
    await user.type(
      screen.getByRole("textbox", { name: /^Notiz zu Retrieval/ }),
      "Brücke zu RAGAS",
    );
    await user.keyboard("{Enter}");
    await waitFor(() =>
      expect(calls.find((c) => c.name === "projects.setReadingNote")?.input).toEqual({
        slug: "rag-evaluation",
        citekey: "lewis2020retrieval",
        note: "Brücke zu RAGAS",
      }),
    );
    expect(await screen.findByText("Brücke zu RAGAS")).toBeVisible();
    expect(stored(data)[1]).toEqual({ item: "lewis2020retrieval", note: "Brücke zu RAGAS" });

    await user.click(screen.getByRole("button", { name: /^Notiz ändern: Brücke zu RAGAS/ }));
    await user.clear(screen.getByRole("textbox", { name: /^Notiz zu Retrieval/ }));
    await user.keyboard("{Enter}");
    await waitFor(() => expect(screen.queryByText("Brücke zu RAGAS")).toBeNull());
    expect(stored(data)[1]).toEqual({ item: "lewis2020retrieval" });
  });

  it("drops an edit of the note on Escape", async () => {
    const user = userEvent.setup();
    const { calls } = renderApp(PATH);
    const rows = await screen.findAllByTestId("item-row");
    await addNote(user, rows[0] as HTMLElement);
    await user.type(screen.getByRole("textbox", { name: /^Notiz zu/ }), "nope{Escape}");
    expect(screen.queryByRole("textbox", { name: /^Notiz zu/ })).toBeNull();
    expect(calls.some((c) => c.name === "projects.setReadingNote")).toBe(false);
  });

  it("counts a status change in the progress and moves the next text on", async () => {
    const user = userEvent.setup();
    renderApp(PATH);
    const rows = await screen.findAllByTestId("item-row");
    await user.click(
      within(rows[0] as HTMLElement).getByRole("button", { name: /^Lesestatus ändern/ }),
    );
    await user.click(await screen.findByRole("menuitem", { name: "Gelesen" }));
    expect(await screen.findByText("2 von 4 gelesen")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Als Nächstes lesen" }));
    expect(
      await screen.findByRole("heading", { level: 1, name: /Retrieval-Augmented/ }),
    ).toBeVisible();
  });

  it("shows the texts in English too", async () => {
    renderApp(PATH, undefined, { lang: "en" });
    expect(await screen.findByText("1 of 4 read")).toBeVisible();
    expect(screen.getByRole("button", { name: "Read next" })).toBeVisible();
  });
});
