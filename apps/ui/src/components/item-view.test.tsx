import { ItemFrontmatter } from "@citegeist/schema";
import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createFixtures } from "../mock/fixtures";
import { renderApp } from "../test-utils";

describe("item view", () => {
  it("shows title, authors, year and metadata", async () => {
    renderApp("/items/lewis2020retrieval");
    expect(
      await screen.findByRole("heading", { level: 1, name: /Retrieval-Augmented Generation/ }),
    ).toBeVisible();
    expect(screen.getByText("Lewis, Patrick; Perez, Ethan")).toBeVisible();
    expect(screen.getByText("(2020)")).toBeVisible();
    expect(screen.getByText("10.48550/arXiv.2005.11401")).toBeVisible();
    expect(screen.getByText("Advances in Neural Information Processing Systems 33")).toBeVisible();
  });

  it("tells the reader that an import did not finish and why", async () => {
    const data = createFixtures();
    const item = data.items.get("latour2005reassembling");
    if (!item) throw new Error("fixture missing");
    item.frontmatter = ItemFrontmatter.parse({
      ...item.frontmatter,
      incomplete: {
        code: "CONVERT_FAILED",
        message: "no article text found",
        at: "2026-10-24T10:00:00.000Z",
      },
    });
    renderApp("/items/latour2005reassembling", data);
    const note = await screen.findByRole("note", { name: "unvollständig" });
    expect(within(note).getByText(/Der Import ist nicht fertig geworden/)).toBeVisible();
    expect(within(note).getByText("CONVERT_FAILED: no article text found")).toBeVisible();
  });

  it("renders the literature note with its headings", async () => {
    renderApp("/items/lewis2020retrieval");
    expect(await screen.findByRole("heading", { level: 2, name: "Open question" })).toBeVisible();
    expect(screen.getByText(/How should retrieval quality be evaluated/)).toBeVisible();
  });

  it("lists the item's cards with quote, page and AI marks", async () => {
    renderApp("/items/luhmann1984soziale");
    const cards = await screen.findAllByTestId("card");
    expect(cards).toHaveLength(3);
    const first = cards[0] as HTMLElement;
    expect(within(first).getByText(/Soziale Systeme bestehen aus Kommunikationen/)).toBeVisible();
    expect(within(first).getByText("S. 31")).toBeVisible();
    expect(within(first).getAllByText(/claude-code/).length).toBeGreaterThan(0);
    expect(within(cards[1] as HTMLElement).getByText(/Compare with Maturana/)).toBeVisible();
    expect(within(cards[2] as HTMLElement).getByText(/Possible counter-position/)).toBeVisible();
  });

  it("shows an empty state for an item without cards or note", async () => {
    renderApp("/items/latour2005reassembling");
    expect(await screen.findByText("Noch keine Karten")).toBeVisible();
    expect(screen.getByText("Noch keine Literaturnotiz.")).toBeVisible();
  });

  it("explains why an agent put an item in the inbox", async () => {
    renderApp("/items/zuboff2019age");
    expect(await screen.findByText(/Vorgeschlagen von/)).toBeVisible();
    expect(screen.getByText("agent:claude-code")).toBeVisible();
  });

  it("shows the error for an unknown citekey", async () => {
    renderApp("/items/does-not-exist");
    expect(await screen.findByRole("alert")).toHaveTextContent(/no item with citekey/);
  });

  it("links to the item's projects", async () => {
    renderApp("/items/luhmann1984soziale");
    const links = await screen.findAllByRole("link", { name: "PhD proposal" });
    // the crumb filters the library, the chip opens the project
    expect(links.map((l) => l.getAttribute("href"))).toContain("/projects/phd-proposal");
    expect(links.map((l) => l.getAttribute("href"))).toContain("/?project=phd-proposal");
  });
});
