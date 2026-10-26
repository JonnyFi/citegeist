import { aggregateGraph, type GraphView, type SemanticGraph } from "@citegeist/ops";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFixtures } from "../mock/fixtures";
import { renderApp } from "../test-utils";
import type { GraphCanvasProps } from "./graph-canvas";
import { buildGraph, layout, readPalette } from "./model";

// jsdom has no WebGL, so sigma cannot start. A stand-in canvas lists what it was given.
vi.mock("./graph-canvas", () => ({
  default: ({ view, onNode, onNodeMenu, onEdge }: GraphCanvasProps) => (
    <div data-testid="fake-canvas">
      <ul aria-label="canvas nodes">
        {view.nodes.map((n) => (
          <li key={n.id}>
            <button type="button" onClick={() => onNode(n.id, { x: 10, y: 10 })}>
              {`canvas ${n.short ?? n.label}`}
            </button>
            <button type="button" onClick={() => onNodeMenu(n.id, { x: 10, y: 10 })}>
              {`menu ${n.short ?? n.label}`}
            </button>
          </li>
        ))}
      </ul>
      <ul aria-label="canvas edges">
        {view.edges.map((e) => (
          <li key={e.id}>
            <button type="button" onClick={() => onEdge(e.id)}>{`edge ${e.id}`}</button>
          </li>
        ))}
      </ul>
    </div>
  ),
}));

const LUHMANN = "luhmann1984soziale";
const HABERMAS = "habermas1981theorie";
const LATOUR = "latour2005reassembling";

const withConnections = (lang?: "de" | "en") => createFixtures(lang, { connections: true });

beforeEach(() => localStorage.removeItem("citegeist.graph.scope"));

const graph: SemanticGraph = {
  nodes: [
    { id: "a", kind: "item", label: "A", short: "A 2001", cards: 4 },
    { id: "b", kind: "item", label: "B", short: "B 2002", cards: 0 },
    { id: "c", kind: "item", label: "C", short: "C 2003", cards: 0 },
    { id: "c_1", kind: "card", label: "one", item: "a", cardKind: "critique" },
    { id: "c_2", kind: "card", label: "two", item: "a" },
  ],
  links: [
    {
      id: "c_1>b:opposes",
      from: "c_1",
      to: "b",
      rel: "opposes",
      status: "accepted",
      evidence: ["c_1"],
      notes: [],
    },
    {
      id: "c_2>c:supports",
      from: "c_2",
      to: "c",
      rel: "supports",
      status: "accepted",
      evidence: ["c_2"],
      notes: [],
    },
  ],
  explanations: [],
};

const palette = readPalette();
const build = (view: GraphView) =>
  buildGraph(view, layout(view), {
    palette,
    edgeLabel: (e) => e.rel,
    alwaysLabelled: () => true,
  });

describe("graph model", () => {
  it("styles each relation of its own and sizes sources by their cards", () => {
    const g = build(aggregateGraph(graph));
    expect(g.getNodeAttribute("a", "size")).toBeGreaterThan(g.getNodeAttribute("b", "size"));
    const opposes = g.getEdgeAttributes("a>b:opposes");
    const supports = g.getEdgeAttributes("a>c:supports");
    expect(opposes.color).toBe(palette.colors["--danger"]);
    expect(opposes.gap).toBeGreaterThan(0);
    expect(supports.color).toBe(palette.colors["--card-definition"]);
    expect(supports.gap).toBe(0);
    expect(opposes.head).toBe("arrow");
  });

  it("keeps the sources in place when one of them opens, and puts its cards around it", () => {
    const closed = aggregateGraph(graph);
    const first = layout(closed);
    const open = aggregateGraph(graph, { expanded: ["a"] });
    const second = layout(open, first);
    for (const id of ["a", "b", "c"]) expect(second.get(id)).toEqual(first.get(id));
    const a = second.get("a") ?? { x: 0, y: 0 };
    const d1 = Math.hypot((second.get("c_1")?.x ?? 0) - a.x, (second.get("c_1")?.y ?? 0) - a.y);
    const d2 = Math.hypot((second.get("c_2")?.x ?? 0) - a.x, (second.get("c_2")?.y ?? 0) - a.y);
    expect(d1).toBeGreaterThan(0);
    expect(d1).toBeCloseTo(d2);
    const g = build(open);
    expect(g.hasEdge("c_1>b:opposes")).toBe(true);
    expect(g.edges().filter((e) => g.getEdgeAttribute(e, "member"))).toHaveLength(2);
  });

  it("lays out the same graph the same way every time", () => {
    expect([...layout(aggregateGraph(graph))]).toEqual([...layout(aggregateGraph(graph))]);
  });
});

describe("graph screen", () => {
  it("opens on the first project with its sources as nodes and no literature note", async () => {
    const user = userEvent.setup();
    renderApp("/", withConnections());
    await user.click(await screen.findByRole("link", { name: "Graph" }));
    const canvas = await screen.findByTestId("fake-canvas");
    const nodes = within(canvas).getByRole("list", { name: "canvas nodes" });
    expect(within(nodes).getByText("canvas Luhmann 1984")).toBeVisible();
    expect(within(nodes).getByText("canvas Habermas 1981")).toBeVisible();
    expect(within(nodes).queryByText(/Reading notes/)).toBeNull();
    // the note that explains Luhmann against Habermas sits on the edge, not on the canvas
    expect(within(nodes).queryByText(/Kontingenz statt Verständigung/)).toBeNull();
    expect(screen.getByRole("combobox", { name: "Umfang" })).toHaveTextContent("PhD proposal");
    expect(screen.queryByRole("button", { name: "2" })).toBeNull();
  });

  it("shows what a connection rests on: reason, explanation note and evidence card", async () => {
    const user = userEvent.setup();
    const { history } = renderApp("/graph?project=phd-proposal", withConnections());
    const list = await screen.findByTestId("graph-edges");
    await user.click(
      await within(list).findByRole("button", {
        name: /Luhmann 1984 widerspricht \(1 Karte\) Habermas 1981/,
      }),
    );
    const panel = await screen.findByTestId("edge-panel");
    expect(panel).toHaveTextContent("Luhmann 1984");
    expect(panel).toHaveTextContent("widerspricht");
    const aside = screen.getByRole("complementary", { name: "Verbindungen" });
    expect(within(aside).getByText(/doppelter Kontingenz, wo Habermas/)).toBeVisible();
    expect(
      within(aside).getByRole("button", { name: "Notiz öffnen: Kontingenz statt Verständigung" }),
    ).toBeVisible();
    expect(within(aside).getByText(/Doppelte Kontingenz ist der Ausgangspunkt/)).toBeVisible();
    await user.click(within(aside).getByRole("button", { name: "Karte öffnen" }));
    await waitFor(() => expect(history.location.pathname).toBe(`/items/${LUHMANN}`));
    expect(history.location.search).toMatch(/card=c_/);
  });

  it("opens the edge panel from a click on the canvas edge", async () => {
    const user = userEvent.setup();
    renderApp("/graph?project=phd-proposal", withConnections());
    const canvas = await screen.findByTestId("fake-canvas");
    await user.click(
      within(canvas).getByRole("button", { name: `edge ${LATOUR}>${LUHMANN}:opposes` }),
    );
    expect(await screen.findByTestId("edge-panel")).toHaveTextContent("Latour 2005");
    await user.click(screen.getByRole("button", { name: "Alle Verbindungen" }));
    expect(screen.queryByTestId("edge-panel")).toBeNull();
  });

  it("shows the cards of a source on click and folds them again", async () => {
    const user = userEvent.setup();
    renderApp("/graph?project=phd-proposal", withConnections());
    const canvas = await screen.findByTestId("fake-canvas");
    const card = /canvas Doppelte Kontingenz/;
    expect(within(canvas).queryByText(card)).toBeNull();
    await user.click(within(canvas).getByRole("button", { name: "canvas Luhmann 1984" }));
    expect(await within(canvas).findByText(card)).toBeVisible();
    // the edge now starts at the card
    const edges = within(canvas).getByRole("list", { name: "canvas edges" });
    expect(within(edges).getByText(new RegExp(`edge c_\\w+>${HABERMAS}:opposes`))).toBeVisible();
    await user.click(within(canvas).getByRole("button", { name: "canvas Luhmann 1984" }));
    await waitFor(() => expect(within(canvas).queryByText(card)).toBeNull());
  });

  it("filters by connection type and by card kind", async () => {
    const user = userEvent.setup();
    renderApp("/graph?project=phd-proposal", withConnections());
    const list = await screen.findByTestId("graph-edges");
    expect(await within(list).findAllByRole("button", { name: /widerspricht/ })).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: "Verbindungsart" }));
    await user.click(await screen.findByRole("menuitemcheckbox", { name: /widerspricht/ }));
    await waitFor(() =>
      expect(within(list).queryAllByRole("button", { name: /widerspricht/ })).toHaveLength(0),
    );
    expect(screen.getByRole("button", { name: "Verbindungsart" })).toHaveTextContent(
      /Verbindungsarten?/,
    );
    await user.click(await screen.findByRole("menuitemcheckbox", { name: /widerspricht/ }));
    await user.keyboard("{Escape}");

    await user.click(screen.getByRole("button", { name: "Kartenart" }));
    for (const kind of ["These", "Definition"]) {
      await user.click(await screen.findByRole("menuitemcheckbox", { name: new RegExp(kind) }));
    }
    await user.keyboard("{Escape}");
    // only the Latour critique is left of the card connections
    await waitFor(() =>
      expect(within(list).getAllByRole("button", { name: /widerspricht/ })).toHaveLength(1),
    );
    expect(within(list).getByRole("button", { name: /Latour 2005/ })).toBeVisible();
  });

  it("narrows the graph to the sources a text cites", async () => {
    const user = userEvent.setup();
    const { history } = renderApp("/graph?project=phd-proposal", withConnections());
    const canvas = await screen.findByTestId("fake-canvas");
    expect(within(canvas).getByText("canvas Latour 2005")).toBeVisible();
    await user.click(screen.getByRole("combobox", { name: "Text" }));
    await user.click(await screen.findByRole("option", { name: "Kapitel 2" }));
    await waitFor(() => expect(history.location.search).toMatch(/text=kapitel-2/));
    await waitFor(() =>
      expect(
        within(screen.getByTestId("fake-canvas")).queryByText("canvas Latour 2005"),
      ).toBeNull(),
    );
    expect(
      within(screen.getByTestId("fake-canvas")).getByText("canvas Luhmann 1984"),
    ).toBeVisible();
  });

  it("shows the graph from one node through its menu and comes back", async () => {
    const user = userEvent.setup();
    const { history } = renderApp("/graph?project=phd-proposal", withConnections());
    const canvas = await screen.findByTestId("fake-canvas");
    await user.click(within(canvas).getByRole("button", { name: "menu Habermas 1981" }));
    const menu = await screen.findByRole("menu", { name: "Aktionen für Habermas 1981" });
    await user.click(within(menu).getByRole("menuitem", { name: "Von hier aus zeigen" }));
    await waitFor(() => expect(history.location.search).toMatch(/node=habermas1981theorie/));
    expect(await screen.findByText("Von hier aus: Habermas 1981")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Zurück zum Überblick" }));
    await waitFor(() => expect(history.location.search).not.toMatch(/node=/));
  });

  it("opens a node from its menu", async () => {
    const user = userEvent.setup();
    const { history } = renderApp("/graph?project=phd-proposal", withConnections());
    const canvas = await screen.findByTestId("fake-canvas");
    await user.click(within(canvas).getByRole("button", { name: "menu Latour 2005" }));
    await user.click(await screen.findByRole("menuitem", { name: "Öffnen" }));
    await waitFor(() => expect(history.location.pathname).toBe(`/items/${LATOUR}`));
  });

  it("speaks English when asked to", async () => {
    renderApp("/graph?project=phd-proposal", withConnections("en"), { lang: "en" });
    expect(await screen.findByRole("complementary", { name: "Connections" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Connection type" })).toHaveTextContent(
      "All connections",
    );
    expect(
      await within(screen.getByTestId("graph-edges")).findByRole("button", {
        name: /Luhmann 1984 opposes \(1 card\) Habermas 1981/,
      }),
    ).toBeVisible();
    expect(await screen.findByTestId("graph-counts")).toHaveTextContent(/nodes, \d+ connections/);
  });
});
