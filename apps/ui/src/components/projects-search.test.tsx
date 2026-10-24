import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderApp } from "../test-utils";

describe("projects", () => {
  it("lists projects with their question count", async () => {
    renderApp("/projects");
    expect(await screen.findByRole("heading", { level: 2, name: "PhD proposal" })).toBeVisible();
    expect(screen.getByText("2 Forschungsfragen")).toBeVisible();
    expect(screen.getByText("Noch keine Forschungsfragen")).toBeVisible();
  });

  it("shows the brief, questions and reading list of a project", async () => {
    renderApp("/projects/phd-proposal");
    expect(await screen.findByRole("heading", { level: 1, name: "PhD proposal" })).toBeVisible();
    expect(screen.getByText(/Das Proposal untersucht Plattformen/)).toBeVisible();
    expect(screen.getByText(/Wie laesst sich Luhmanns Kommunikationsbegriff/)).toBeVisible();
    // the reading list is a tab of the project, not a jump into the library
    const list = await screen.findByRole("link", { name: /Leseliste/ });
    expect(list).toHaveAttribute("href", "/projects/phd-proposal?tab=list");
    expect(list).toHaveTextContent("3");
  });

  it("opens the reading list inside the project, with cards and matrix one click away", async () => {
    const user = userEvent.setup();
    const { history } = renderApp("/projects/phd-proposal");
    await user.click(await screen.findByRole("link", { name: /Leseliste/ }));
    const rows = await screen.findAllByTestId("item-row");
    expect(rows).toHaveLength(3);
    expect(history.location.pathname).toBe("/projects/phd-proposal");
    expect(screen.getByRole("link", { name: /Leseliste/ })).toHaveAttribute("aria-current", "page");
    // the project breadcrumb and the other tabs stay
    const crumb = screen.getByRole("navigation", { name: "Pfad" });
    expect(within(crumb).getByRole("link", { name: "Projekte" })).toBeVisible();
    expect(screen.getByRole("link", { name: /Karten/ })).toBeVisible();
    await user.click(screen.getByRole("link", { name: "Matrix" }));
    await waitFor(() => expect(history.location.search).toContain("matrix"));
  });

  it("says so when the reading list of a project is empty", async () => {
    renderApp("/projects/reading-group?tab=list");
    expect(await screen.findByText("Noch keine Quellen in diesem Projekt.")).toBeVisible();
  });

  it("leads back to the project from the library filtered by it", async () => {
    const user = userEvent.setup();
    const { history } = renderApp("/?project=phd-proposal");
    const crumb = await screen.findByRole("navigation", { name: "Pfad" });
    const back = await within(crumb).findByRole("link", { name: "PhD proposal" });
    expect(back).toHaveAttribute("href", "/projects/phd-proposal");
    await user.click(back);
    await waitFor(() => expect(history.location.pathname).toBe("/projects/phd-proposal"));
  });

  it("says so when a project has no brief", async () => {
    renderApp("/projects/reading-group");
    expect(await screen.findByText("Dieses Projekt hat noch keinen Brief.")).toBeVisible();
  });
});

describe("search", () => {
  it("finds items and cards for a query from the search bar", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await user.click(await screen.findByRole("link", { name: "Suchen" }));
    await user.type(await screen.findByRole("searchbox", { name: "Suche" }), "autopoiesis{Enter}");
    // fixture note of luhmann mentions Autopoiesis
    const hits = await screen.findAllByTestId("hit");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]).toHaveTextContent("Soziale Systeme");
  });

  it("shows page numbers on card hits", async () => {
    renderApp("/search?q=transformer");
    const hits = await screen.findAllByTestId("hit");
    expect(hits.some((h) => h.textContent?.includes("S. 2"))).toBe(true);
  });

  it("shows an empty state without hits", async () => {
    renderApp("/search?q=xyzzy");
    expect(await screen.findByText("Nichts gefunden")).toBeVisible();
  });

  it("prompts for a query when there is none", async () => {
    renderApp("/search");
    await waitFor(() => expect(screen.getByText("Durchsuche deine Bibliothek")).toBeVisible());
  });
});
