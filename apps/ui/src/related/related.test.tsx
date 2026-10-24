import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderApp } from "../test-utils";
import { filterByYear } from "./related-works";

const OVERVIEW = "/items/luhmann1984soziale";

async function works() {
  return await screen.findAllByTestId("related-work");
}

const rowOf = (title: RegExp) => {
  const row = screen
    .getAllByTestId("related-work")
    .find((r) => within(r).queryByText(title) !== null);
  if (!row) throw new Error(`no related work ${title}`);
  return row;
};

describe("related works", () => {
  it("lists the references of a source with in-library, in-inbox and new markers", async () => {
    renderApp(OVERVIEW);
    const rows = await works();
    expect(rows).toHaveLength(5);
    expect(rowOf(/Theorie des kommunikativen Handelns/)).toHaveAttribute("data-status", "library");
    expect(within(rowOf(/Theorie des kommunikativen/)).getByText("In Bibliothek")).toBeVisible();
    expect(rowOf(/The Social System/)).toHaveAttribute("data-status", "new");
    expect(
      screen.getByText(/Insgesamt 5: 1 in der Bibliothek, 0 in der Inbox, 4 neu/),
    ).toBeVisible();
  });

  it("marks citing works that wait in the inbox", async () => {
    const user = userEvent.setup();
    renderApp(OVERVIEW);
    await works();
    await user.click(screen.getByRole("button", { name: "Zitiert von" }));
    await waitFor(() => expect(screen.getByText(/Formen der Organisation/)).toBeVisible());
    expect(rowOf(/Formen der Organisation/)).toHaveAttribute("data-status", "inbox");
    expect(within(rowOf(/Formen der Organisation/)).getByText("In der Inbox")).toBeVisible();
    expect(rowOf(/Reassembling the Social/)).toHaveAttribute("data-status", "library");
    // most cited first
    const titles = screen.getAllByTestId("related-work").map((r) => r.textContent ?? "");
    expect(titles[0]).toContain("Reassembling the Social");
  });

  it("adds a new work to the inbox with one click", async () => {
    const user = userEvent.setup();
    const { calls } = renderApp(OVERVIEW);
    await works();
    await user.click(screen.getByRole("button", { name: /^In die Inbox: The Social System/ }));
    await waitFor(() => expect(rowOf(/The Social System/)).toHaveAttribute("data-status", "inbox"));
    const call = calls.find((c) => c.name === "graph.addCandidates");
    expect(call?.input).toMatchObject({
      from: "luhmann1984soziale",
      via: "references",
      candidates: [{ doi: "10.9999/mock.parsons1951", title: "The Social System" }],
    });
    expect(await screen.findByText(/Zur Inbox hinzugefügt: 1\./)).toBeVisible();
  });

  it("adds all new works that can be added, and leaves out the ones without an identifier", async () => {
    const user = userEvent.setup();
    const { calls } = renderApp(OVERVIEW);
    await works();
    expect(
      within(rowOf(/Laws of Form/)).getByRole("button", { name: /In die Inbox/ }),
    ).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Alle neuen hinzufügen (3)" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Alle neuen hinzufügen (0)" })).toBeDisabled(),
    );
    const call = calls.find((c) => c.name === "graph.addCandidates");
    const input = call?.input as { candidates: unknown[] };
    expect(input.candidates).toHaveLength(3);
  });

  it("filters by year", async () => {
    const user = userEvent.setup();
    renderApp(OVERVIEW);
    await works();
    await user.type(screen.getByRole("spinbutton", { name: "Von Jahr" }), "1975");
    await waitFor(() => expect(screen.getAllByTestId("related-work")).toHaveLength(2));
    expect(screen.queryByText(/The Social System/)).not.toBeInTheDocument();
    await user.type(screen.getByRole("spinbutton", { name: "Bis Jahr" }), "1980");
    await waitFor(() => expect(screen.getAllByTestId("related-work")).toHaveLength(1));
    expect(screen.getByText(/Autopoiesis and Cognition/)).toBeVisible();
  });

  it("says so when the period holds no work", async () => {
    const user = userEvent.setup();
    renderApp(OVERVIEW);
    await works();
    await user.type(screen.getByRole("spinbutton", { name: "Von Jahr" }), "2030");
    expect(await screen.findByText("Kein Werk liegt im gewählten Zeitraum.")).toBeVisible();
  });

  it("shows English strings", async () => {
    renderApp(OVERVIEW, undefined, { lang: "en" });
    await works();
    expect(screen.getByRole("heading", { name: "Related works" })).toBeVisible();
    expect(screen.getAllByRole("button", { name: /^Add to inbox/ }).length).toBeGreaterThan(0);
  });
});

describe("filterByYear", () => {
  const list = [
    { year: 1999, status: "new", addable: true },
    { year: 2010, status: "new", addable: true },
    { status: "new", addable: false },
  ] as never[];
  it("keeps everything while no year is chosen", () => {
    expect(filterByYear(list, undefined, undefined)).toHaveLength(3);
  });
  it("drops works without a year once a year is chosen", () => {
    expect(filterByYear(list, 2000, undefined)).toHaveLength(1);
    expect(filterByYear(list, undefined, 2000)).toHaveLength(1);
  });
});

describe("retraction and correction warnings", () => {
  it("shows a badge on items in the library table with the link to the notice", async () => {
    renderApp("/");
    const row = (await screen.findAllByTestId("item-row")).find((r) =>
      r.textContent?.includes("es2023ragas"),
    ) as HTMLElement;
    const badge = await within(row).findByRole("link", { name: "Zurückgezogen, Hinweis öffnen" });
    expect(badge).toHaveAttribute("href", "https://doi.org/10.9999/mock.notice.es2023");
    const corrected = (await screen.findAllByTestId("item-row")).find((r) =>
      r.textContent?.includes("thakur2021beir"),
    ) as HTMLElement;
    expect(await within(corrected).findByText("Korrigiert")).toBeVisible();
    const clean = (await screen.findAllByTestId("item-row")).find((r) =>
      r.textContent?.includes("kuhn1962structure"),
    ) as HTMLElement;
    expect(within(clean).queryByText(/Zurückgezogen|Korrigiert/)).not.toBeInTheDocument();
  });

  it("does not open the item when the badge is clicked", async () => {
    const user = userEvent.setup();
    const { history } = renderApp("/");
    const row = (await screen.findAllByTestId("item-row")).find((r) =>
      r.textContent?.includes("es2023ragas"),
    ) as HTMLElement;
    const badge = await within(row).findByRole("link", { name: /Zurückgezogen/ });
    badge.addEventListener("click", (e) => e.preventDefault());
    await user.click(badge);
    expect(history.location.pathname).toBe("/");
  });

  it("shows the warning, the notice and the link on the overview and in the header", async () => {
    renderApp("/items/es2023ragas");
    const note = await screen.findByTestId("retraction-note");
    expect(within(note).getByText("Zurückgezogen")).toBeVisible();
    expect(within(note).getByText(/Retraction Watch/)).toBeVisible();
    expect(within(note).getByRole("link", { name: /Hinweis öffnen/ })).toHaveAttribute(
      "href",
      "https://doi.org/10.9999/mock.notice.es2023",
    );
    // the header keeps the badge on the reading tab too
    expect(
      screen.getAllByRole("link", { name: "Zurückgezogen, Hinweis öffnen" }).length,
    ).toBeGreaterThan(0);
  });

  it("keeps the header badge on the reading tab", async () => {
    renderApp("/items/es2023ragas?tab=read");
    expect(
      await screen.findByRole("link", { name: "Zurückgezogen, Hinweis öffnen" }),
    ).toBeVisible();
  });

  it("shows no warning on an item without a marker", async () => {
    renderApp(OVERVIEW);
    await works();
    expect(screen.queryByTestId("retraction-note")).not.toBeInTheDocument();
  });
});
