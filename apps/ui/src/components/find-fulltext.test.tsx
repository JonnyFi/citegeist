import { ItemFrontmatter } from "@citegeist/schema";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { createFixtures } from "../mock/fixtures";
import { renderApp } from "../test-utils";

const KEY = "latour2005reassembling";
const FIND = "Volltext erneut suchen";

/** Latour without a file, whose lookup found nothing: the case the button is for. */
function withMissingFulltext(lang: "de" | "en" = "de") {
  const data = createFixtures(lang);
  const item = data.items.get(KEY);
  if (!item) throw new Error("fixture missing");
  item.frontmatter = ItemFrontmatter.parse({
    ...item.frontmatter,
    DOI: "10.1000/latour",
    sources: [],
    fulltext: {
      status: "missing",
      checked_at: "2026-10-24T10:00:00.000Z",
      tried: [{ source: "unpaywall", outcome: "none" }],
    },
  });
  return data;
}

const searches = (calls: Array<{ name: string }>) =>
  calls.filter((c) => c.name === "items.findFulltext");

describe("Volltext erneut suchen", () => {
  it("sits next to 'PDF anhängen' for an item without full text", async () => {
    renderApp(`/items/${KEY}`, withMissingFulltext());
    const block = await screen.findByTestId("attach-pdf");
    expect(within(block).getByRole("button", { name: "PDF anhängen" })).toBeVisible();
    expect(within(block).getByRole("button", { name: FIND })).toBeVisible();
  });

  it("is absent when the lookup left no 'missing' marker", async () => {
    const data = withMissingFulltext();
    const item = data.items.get(KEY);
    if (!item) throw new Error("fixture missing");
    const { fulltext: _marker, ...rest } = item.frontmatter;
    item.frontmatter = ItemFrontmatter.parse(rest);
    renderApp(`/items/${KEY}`, data);
    expect(await screen.findByRole("button", { name: "PDF anhängen" })).toBeVisible();
    expect(screen.queryByRole("button", { name: FIND })).toBeNull();
  });

  it("never searches by itself", async () => {
    const { calls } = renderApp(`/items/${KEY}`, withMissingFulltext());
    await screen.findByRole("button", { name: FIND });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(searches(calls)).toHaveLength(0);
  });

  it("is absent on an item that has a file", async () => {
    renderApp("/items/luhmann1984soziale");
    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByRole("button", { name: FIND })).toBeNull();
  });

  it("shows progress while it runs, then 'Kein freier Volltext gefunden' with the hosts tried", async () => {
    const user = userEvent.setup();
    const { calls } = renderApp(`/items/${KEY}`, withMissingFulltext());
    await user.click(await screen.findByRole("button", { name: FIND }));

    // while the core searches: the button is busy and the sources are named as being checked
    const busy = await screen.findByRole("button", { name: "Suche läuft" });
    expect(busy).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Die offenen Quellen werden geprüft.");

    const result = await screen.findByText("Kein freier Volltext gefunden");
    expect(result).toBeVisible();
    expect(searches(calls)).toHaveLength(1);
    expect(searches(calls)[0]).toMatchObject({ input: { citekey: KEY } });

    const summary = screen.getByText("Geprüfte Adressen (3)");
    expect(screen.getByText(/repo\.example\.org/)).not.toBeVisible();
    await user.click(summary);
    expect(screen.getByText(/repo\.example\.org/)).toBeVisible();
    expect(screen.getByText(/publisher\.example\.com/)).toHaveTextContent("Fehler");
    expect(screen.getByText(/Unpaywall/, { selector: "li" })).toBeVisible();

    // the button is back; a second click searches again
    const again = screen.getByRole("button", { name: FIND });
    expect(again).toBeEnabled();
    await user.click(again);
    await waitFor(() => expect(searches(calls)).toHaveLength(2));
  });

  it("says 'Volltext gefunden' and shows the item's file when the search succeeds", async () => {
    const user = userEvent.setup();
    const { calls, data } = renderApp(`/items/${KEY}`, withMissingFulltext(), {
      findFulltext: "found",
    });
    await user.click(await screen.findByRole("button", { name: FIND }));

    expect(await screen.findByText("Volltext gefunden")).toBeVisible();
    expect(screen.getByText("Die PDF-Datei ist angehängt, die Umwandlung läuft.")).toBeVisible();
    // the attach block is gone because the item has a file now; the result stays
    await waitFor(() => expect(screen.queryByTestId("attach-pdf")).toBeNull());
    expect(screen.getByText("Volltext gefunden")).toBeVisible();
    expect(screen.getByText("Geprüfte Adressen (3)")).toBeVisible();
    expect(data.items.get(KEY)?.frontmatter.sources).toHaveLength(1);
    expect(data.items.get(KEY)?.frontmatter.fulltext).toBeUndefined();
    expect(searches(calls)).toHaveLength(1);
  });

  it("shows the message of the core when the search fails", async () => {
    const user = userEvent.setup();
    renderApp(`/items/${KEY}`, withMissingFulltext(), { findFulltext: "error" });
    await user.click(await screen.findByRole("button", { name: FIND }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Die Suche ist fehlgeschlagen: FULLTEXT_FAILED",
    );
    expect(screen.getByRole("button", { name: FIND })).toBeEnabled();
  });

  it("speaks English with the English catalog", async () => {
    const user = userEvent.setup();
    renderApp(`/items/${KEY}`, withMissingFulltext("en"), { lang: "en" });
    await user.click(await screen.findByRole("button", { name: "Search full text again" }));
    expect(await screen.findByText("No open full text found")).toBeVisible();
    expect(screen.getByText("Addresses checked (3)")).toBeVisible();
  });
});
