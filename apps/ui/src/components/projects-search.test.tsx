import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderApp } from "../test-utils";

describe("projects", () => {
  it("lists projects with their question count", async () => {
    renderApp("/projects");
    expect(await screen.findByRole("heading", { level: 2, name: "PhD proposal" })).toBeVisible();
    expect(screen.getByText("2 research questions")).toBeVisible();
    expect(screen.getByText("No research questions yet")).toBeVisible();
  });

  it("shows the brief, questions and reading list of a project", async () => {
    renderApp("/projects/phd-proposal");
    expect(await screen.findByRole("heading", { level: 1, name: "PhD proposal" })).toBeVisible();
    expect(screen.getByText(/Das Proposal untersucht Plattformen/)).toBeVisible();
    expect(screen.getByText(/Wie laesst sich Luhmanns Kommunikationsbegriff/)).toBeVisible();
    expect(await screen.findAllByTestId("item-row")).toHaveLength(3);
  });

  it("says so when a project has no brief", async () => {
    renderApp("/projects/reading-group");
    expect(await screen.findByText("This project has no brief yet.")).toBeVisible();
    expect(await screen.findByText("No items in this project yet.")).toBeVisible();
  });
});

describe("search", () => {
  it("finds items and cards for a query from the search bar", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await user.type(await screen.findByRole("searchbox", { name: "Search" }), "autopoiesis{Enter}");
    // fixture note of luhmann mentions Autopoiesis
    const hits = await screen.findAllByTestId("hit");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]).toHaveTextContent("Soziale Systeme");
  });

  it("shows page numbers on card hits", async () => {
    renderApp("/search?q=transformer");
    const hits = await screen.findAllByTestId("hit");
    expect(hits.some((h) => h.textContent?.includes("p. 2"))).toBe(true);
  });

  it("shows an empty state without hits", async () => {
    renderApp("/search?q=xyzzy");
    expect(await screen.findByText("Nothing found")).toBeVisible();
  });

  it("prompts for a query when there is none", async () => {
    renderApp("/search");
    await waitFor(() => expect(screen.getByText("Search your library")).toBeVisible());
  });
});
