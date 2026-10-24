import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { renderApp } from "../test-utils";

afterEach(() => localStorage.clear());

describe("icon rail", () => {
  it("is collapsed by default and expands with the project list, remembering the choice", async () => {
    const user = userEvent.setup();
    renderApp("/");
    expect(screen.queryByTestId("rail-projects")).toBeNull();
    await user.click(await screen.findByRole("button", { name: "Leiste ausklappen" }));
    const projects = await screen.findByTestId("rail-projects");
    expect(within(projects).getByRole("link", { name: /PhD proposal/ })).toHaveAttribute(
      "href",
      "/?project=phd-proposal",
    );
    expect(localStorage.getItem("citegeist.rail")).toBe("open");
    await user.click(screen.getByRole("button", { name: "Leiste einklappen" }));
    expect(screen.queryByTestId("rail-projects")).toBeNull();
  });

  it("marks the library as current while a source is open", async () => {
    renderApp("/items/luhmann1984soziale");
    const library = await screen.findByRole("link", { name: "Bibliothek" });
    expect(library).toHaveAttribute("aria-current", "page");
  });
});

describe("right column", () => {
  it("offers cards, connections and the agent on a source and switches between them", async () => {
    const user = userEvent.setup();
    renderApp("/items/luhmann1984soziale");
    const tabs = await screen.findAllByRole("tab");
    expect(tabs.map((t) => t.textContent?.replace(/\s*\d+$/, ""))).toEqual([
      "Karten",
      "Verbindungen",
      "Agent",
    ]);
    await user.click(screen.getByRole("tab", { name: /^Agent/ }));
    expect(await screen.findByTestId("chat-panel")).toBeVisible();
  });

  it("opens a chat-only column from the rail on screens without one", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await user.click(await screen.findByRole("button", { name: "Chat öffnen oder schließen" }));
    expect(await screen.findByTestId("chat-panel")).toBeVisible();
  });
});

describe("job slot", () => {
  it("says so when nothing runs", async () => {
    renderApp("/");
    expect(await screen.findByText("Keine Hintergrundarbeit")).toBeVisible();
  });
});
