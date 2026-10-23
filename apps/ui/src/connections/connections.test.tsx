import { linksDecide, linksPropose, notesGet } from "@citegeist/ops";
import { createMemoryHistory } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { App } from "../app";
import { createMockCore } from "../mock/core";
import { createFixtures } from "../mock/fixtures";
import { renderApp } from "../test-utils";
import { groupBy, linkTarget, relationKey, UNTYPED } from "./model";

const AUTOPOIESIS = "n_0000000000000001";
const FRAGE = "n_0000000000000003";
const LUHMANN = "luhmann1984soziale";

describe("connections panel on a note", () => {
  it("shows the wiki links of the note and the notes that link to it", async () => {
    renderApp(`/notes/${AUTOPOIESIS}`);
    const panel = await screen.findByTestId("connections");
    const outgoing = await within(panel).findByTestId("outgoing");
    expect(within(outgoing).getByText("Verknüpft")).toBeVisible();
    expect(
      within(outgoing).getByRole("button", { name: /Soziale Systeme: Grundriss/ }),
    ).toBeVisible();
    expect(
      within(outgoing).getByRole("button", { name: "Das Zettelkasten-Prinzip" }),
    ).toBeVisible();
    const incoming = within(panel).getByTestId("incoming");
    expect(
      within(incoming).getByRole("button", { name: "Das Zettelkasten-Prinzip" }),
    ).toBeVisible();
  });

  it("says so when a note has no connections", async () => {
    renderApp(`/notes/${FRAGE}`);
    expect(await screen.findByText("Noch keine Verbindungen.")).toBeVisible();
    expect(screen.queryByTestId("proposals")).toBeNull();
  });

  it("proposes connections as a job and lets the user accept or reject each", async () => {
    const user = userEvent.setup();
    const { calls } = renderApp(`/notes/${AUTOPOIESIS}`);
    const panel = await screen.findByTestId("connections");
    await user.click(
      await within(panel).findByRole("button", { name: "Verbindungen vorschlagen" }),
    );
    expect(await within(panel).findByTestId("propose-state")).toHaveAttribute(
      "data-state",
      "running",
    );

    const proposals = await within(panel).findByTestId("proposals", {}, { timeout: 5000 });
    expect(calls.map((c) => c.name)).toContain("links.propose");
    await waitFor(() =>
      expect(within(panel).getByTestId("propose-state")).toHaveAttribute("data-state", "done"),
    );
    const cards = within(proposals).getAllByRole("listitem");
    expect(cards).toHaveLength(2);
    expect(within(cards[0] as HTMLElement).getByText("stützt")).toBeVisible();
    expect(
      within(cards[0] as HTMLElement).getByText(/Die Notiz stützt sich auf Soziale Systeme/),
    ).toBeVisible();
    expect(within(cards[0] as HTMLElement).getByText(/^Beleg:/)).toBeVisible();
    expect(within(cards[1] as HTMLElement).getByText("verwandt")).toBeVisible();

    await user.click(
      within(proposals).getByRole("button", {
        name: /Verbindung zu Soziale Systeme.* annehmen/,
      }),
    );
    await waitFor(() => {
      const accept = calls.find((c) => c.name === "links.decide");
      expect(accept?.input).toEqual({ note: AUTOPOIESIS, accept: [0], reject: [] });
    });
    const outgoing = await within(panel).findByTestId("outgoing");
    expect(within(outgoing).getByText("stützt")).toBeVisible();

    await user.click(
      await within(panel).findByRole("button", {
        name: "Verbindung zu Das Zettelkasten-Prinzip verwerfen",
      }),
    );
    await waitFor(() => expect(within(panel).queryByTestId("proposals")).toBeNull());
    const last = calls.filter((c) => c.name === "links.decide").at(-1);
    expect(last?.input).toEqual({ note: AUTOPOIESIS, accept: [], reject: [1] });
    expect(within(outgoing).queryByText("verwandt")).toBeNull();
  });

  it("reports a failed proposal run", async () => {
    const user = userEvent.setup();
    const data = createFixtures();
    const core = createMockCore(data, { aiDelayMs: 0 });
    const original = core.call.bind(core);
    core.call = ((contract, input) => {
      if (contract.name === linksPropose.name)
        return Promise.reject(new Error("AI_FAILED: no backend"));
      return original(contract, input);
    }) as typeof core.call;
    render(
      <App
        core={core}
        history={createMemoryHistory({ initialEntries: [`/notes/${AUTOPOIESIS}`] })}
        lang="de"
      />,
    );
    await user.click(await screen.findByRole("button", { name: "Verbindungen vorschlagen" }));
    const state = await screen.findByTestId("propose-state");
    await waitFor(() => expect(state).toHaveAttribute("data-state", "failed"));
    expect(state).toHaveTextContent("Die Suche nach Verbindungen ist fehlgeschlagen.");
  });

  it("speaks English when asked to", async () => {
    renderApp(`/notes/${AUTOPOIESIS}`, undefined, { lang: "en" });
    const panel = await screen.findByTestId("connections");
    expect(await within(panel).findByRole("heading", { name: /Connections/ })).toBeVisible();
    expect(within(panel).getByRole("button", { name: "Propose connections" })).toBeVisible();
    expect(within(panel).getByRole("link", { name: "Show in graph" })).toBeVisible();
  });
});

describe("connections panel on an item", () => {
  it("lists the notes that link to the item, grouped by relation", async () => {
    const data = createFixtures();
    const pre = createMockCore(data, { aiDelayMs: 0 });
    await pre.call(linksPropose, { note: AUTOPOIESIS });
    await waitFor(async () => {
      const note = await pre.call(notesGet, { id: AUTOPOIESIS });
      expect(note.frontmatter.links).toHaveLength(2);
    });
    await pre.call(linksDecide, { note: AUTOPOIESIS, accept: [0], reject: [] });

    renderApp(`/items/${LUHMANN}`, data);
    const panel = await screen.findByTestId("connections");
    const incoming = await within(panel).findByTestId("incoming");
    expect(within(incoming).getByText("stützt")).toBeVisible();
    expect(
      within(incoming).getAllByRole("button", { name: "Autopoiesis und Kommunikation" }).length,
    ).toBeGreaterThan(0);
    expect(within(panel).queryByRole("button", { name: "Verbindungen vorschlagen" })).toBeNull();
  });

  it("opens a connected note from the item", async () => {
    const user = userEvent.setup();
    renderApp(`/items/${LUHMANN}`);
    const incoming = await screen.findByTestId("incoming");
    await user.click(
      within(incoming).getAllByRole("button", {
        name: "Autopoiesis und Kommunikation",
      })[0] as HTMLElement,
    );
    expect(await screen.findByRole("textbox", { name: "Titel der Notiz" })).toHaveValue(
      "Autopoiesis und Kommunikation",
    );
  });
});

describe("model helpers", () => {
  it("maps unknown relations to untyped and keeps the vocabulary order", () => {
    expect(relationKey("supports")).toBe("supports");
    expect(relationKey("wiki")).toBe(UNTYPED);
    expect(relationKey(undefined)).toBe(UNTYPED);
    const groups = groupBy(
      [{ r: "wiki" }, { r: "opposes" }, { r: "supports" }, { r: "cites" }],
      (x) => relationKey(x.r),
    );
    expect(groups.map(([k]) => k)).toEqual(["supports", "opposes", "cites", UNTYPED]);
  });

  it("reads the target of a wiki link value", () => {
    expect(linkTarget("[[luhmann1984soziale]]")).toBe("luhmann1984soziale");
    expect(linkTarget("[[c_01JB8Z3Q|Beleg]]")).toBe("c_01JB8Z3Q");
    expect(linkTarget("plain")).toBe("plain");
  });
});
