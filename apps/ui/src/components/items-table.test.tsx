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
    expect(within(luhmann as HTMLElement).getByText("Reading")).toBeInTheDocument();
  });

  it("narrows by reading status", async () => {
    const user = userEvent.setup();
    const { calls } = renderApp("/");
    await rows();
    await user.click(screen.getByRole("button", { name: "Reading" }));
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
    await user.click(screen.getByRole("combobox", { name: "Project" }));
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
    expect(await screen.findByText("No items match these filters")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    await waitFor(async () => expect(await rows()).toHaveLength(11));
  });

  it("shows the empty state for an empty library", async () => {
    const data = createFixtures();
    data.items.clear();
    renderApp("/", data);
    expect(await screen.findByText("Your library is empty")).toBeVisible();
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
    await user.click(screen.getByRole("button", { name: "Load more" }));
    await waitFor(async () => expect(await rows()).toHaveLength(61));
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
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

  it("lists inbox items with accept and discard", async () => {
    const user = userEvent.setup();
    renderApp("/inbox");
    expect(await rows()).toHaveLength(3);
    await user.click(screen.getByRole("button", { name: "Accept all" }));
    expect(await screen.findByText("The inbox is empty")).toBeVisible();
  });
});
