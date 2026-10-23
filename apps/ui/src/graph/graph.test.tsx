import { linksDecide, linksPropose, notesGet } from "@citegeist/ops";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Neighbors } from "../connections/model";
import { createMockCore } from "../mock/core";
import { createFixtures } from "../mock/fixtures";
import { renderApp } from "../test-utils";
import { buildGraph, filterGraph, NO_FILTERS, relationCounts } from "./model";

// jsdom has no WebGL, so sigma cannot start. A stand-in canvas lists the nodes it was given.
vi.mock("./graph-canvas", () => ({
  default: ({ data, onOpen }: { data: Neighbors; onOpen: (id: string) => void }) => (
    <ul data-testid="fake-canvas">
      {data.nodes.map((n) => (
        <li key={n.id}>
          <button type="button" onClick={() => onOpen(n.id)}>{`canvas ${n.label}`}</button>
        </li>
      ))}
    </ul>
  ),
}));

const AUTOPOIESIS = "n_0000000000000001";
const LUHMANN = "luhmann1984soziale";

const nodes: Neighbors["nodes"] = [
  { id: "n_1", kind: "note", label: "Notiz" },
  { id: "luhmann", kind: "item", label: "Luhmann" },
  { id: "c_1", kind: "card", label: "Karte" },
  { id: "n_2", kind: "note", label: "Andere Notiz" },
];
const edges: Neighbors["edges"] = [
  { from: "n_1", to: "luhmann", rel: "supports", status: "accepted" },
  { from: "n_1", to: "luhmann", rel: "qualifies", status: "accepted" },
  { from: "c_1", to: "luhmann", rel: "excerpt-of", status: "accepted" },
  { from: "n_1", to: "n_2", rel: "related", status: "proposed" },
  { from: "n_2", to: "n_1", rel: "wiki", status: "accepted" },
];
const data: Neighbors = { nodes, edges };

describe("graph model", () => {
  it("builds a sigma graph with every edge, kind colours and a larger centre", () => {
    const graph = buildGraph(data, "n_1");
    expect(graph.order).toBe(4);
    expect(graph.size).toBe(5);
    expect(graph.getNodeAttribute("n_1", "size")).toBeGreaterThan(
      graph.getNodeAttribute("luhmann", "size"),
    );
    expect(graph.getNodeAttribute("luhmann", "color")).not.toBe(
      graph.getNodeAttribute("n_1", "color"),
    );
    for (const id of graph.nodes()) {
      expect(Number.isFinite(graph.getNodeAttribute(id, "x"))).toBe(true);
      expect(Number.isFinite(graph.getNodeAttribute(id, "y"))).toBe(true);
    }
    const proposed = graph
      .edges()
      .filter((e) => graph.getEdgeAttribute(e, "status") === "proposed");
    expect(proposed).toHaveLength(1);
    expect(graph.getEdgeAttribute(proposed[0] as string, "color")).not.toBe(
      graph.getEdgeAttribute(graph.edges()[0] as string, "color"),
    );
  });

  it("handles a graph with a single node", () => {
    const graph = buildGraph({ nodes: [nodes[0] as Neighbors["nodes"][number]], edges: [] }, "n_1");
    expect(graph.order).toBe(1);
    expect(graph.size).toBe(0);
  });

  it("filters by relation and drops nodes that no visible edge reaches", () => {
    const out = filterGraph(data, "n_1", {
      ...NO_FILTERS,
      hiddenRelations: new Set(["supports", "qualifies", "excerpt-of"]),
    });
    expect(out.edges.map((e) => e.rel)).toEqual(["related", "wiki"]);
    expect(out.nodes.map((n) => n.id).sort()).toEqual(["n_1", "n_2"]);
  });

  it("filters by node kind but keeps the centre", () => {
    const out = filterGraph(data, "n_1", { ...NO_FILTERS, hiddenKinds: new Set(["note"]) });
    expect(out.nodes.map((n) => n.id).sort()).toEqual(["n_1", "c_1", "luhmann"].sort());
    expect(out.edges.every((e) => e.from !== "n_2" && e.to !== "n_2")).toBe(true);
  });

  it("hides proposals on request", () => {
    const out = filterGraph(data, "n_1", { ...NO_FILTERS, showProposed: false });
    expect(out.edges.some((e) => e.status === "proposed")).toBe(false);
    expect(out.edges).toHaveLength(4);
  });

  it("counts relations in vocabulary order with untyped last", () => {
    expect(relationCounts(edges)).toEqual([
      ["supports", 1],
      ["qualifies", 1],
      ["related", 1],
      ["excerpt-of", 1],
      ["untyped", 1],
    ]);
  });
});

describe("graph screen", () => {
  it("opens from the sidebar around the newest note", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await user.click(await screen.findByRole("link", { name: "Graph" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Graph" })).toBeVisible();
    const canvas = await screen.findByTestId("fake-canvas");
    expect(within(canvas).getByText("canvas Autopoiesis und Kommunikation")).toBeVisible();
    expect(within(canvas).getByText("canvas Das Zettelkasten-Prinzip")).toBeVisible();
    expect(within(canvas).getByText(/canvas Soziale Systeme: Grundriss/)).toBeVisible();
    expect(screen.getByTestId("graph-counts")).toHaveTextContent(/\d+ Knoten, \d+ Verbindungen/);
  });

  it("filters by relation and node kind", async () => {
    const user = userEvent.setup();
    renderApp(`/graph?node=${AUTOPOIESIS}`);
    const canvas = await screen.findByTestId("fake-canvas");
    expect(within(canvas).getAllByRole("button").length).toBeGreaterThanOrEqual(4);

    const sidebar = screen.getByRole("complementary", { name: "Filter und Knoten" });
    expect(within(canvas).getByText(/canvas Soziale Systeme bestehen/)).toBeVisible();
    await user.click(within(sidebar).getByRole("checkbox", { name: /Karte/ }));
    await waitFor(() =>
      expect(
        within(screen.getByTestId("fake-canvas")).queryByText(/canvas Soziale Systeme bestehen/),
      ).toBeNull(),
    );
    expect(within(canvas).getByText(/canvas Soziale Systeme: Grundriss/)).toBeVisible();

    await user.click(within(sidebar).getByRole("checkbox", { name: /Verknüpft/ }));
    // the only edges around the note were wiki links, so only the empty state remains
    expect(await screen.findByText("Keine Verbindungen")).toBeVisible();
  });

  it("shows typed connections by their relation and filters them", async () => {
    const user = userEvent.setup();
    const mockData = createFixtures();
    const pre = createMockCore(mockData, { aiDelayMs: 0 });
    await pre.call(linksPropose, { note: AUTOPOIESIS });
    await waitFor(async () => {
      expect((await pre.call(notesGet, { id: AUTOPOIESIS })).frontmatter.links).toHaveLength(2);
    });
    await pre.call(linksDecide, { note: AUTOPOIESIS, accept: [0], reject: [] });

    renderApp(`/graph?node=${AUTOPOIESIS}`, mockData);
    const sidebar = await screen.findByRole("complementary", { name: "Filter und Knoten" });
    expect(await within(sidebar).findByRole("checkbox", { name: /stützt/ })).toBeChecked();
    expect(within(sidebar).getByRole("checkbox", { name: /verwandt/ })).toBeChecked();
    await user.click(within(sidebar).getByRole("checkbox", { name: /Vorschläge zeigen/ }));
    await waitFor(() =>
      expect(screen.getByTestId("graph-counts")).toHaveTextContent(/Verbindungen/),
    );
    const before = screen.getByTestId("graph-counts").textContent;
    await user.click(within(sidebar).getByRole("checkbox", { name: /Vorschläge zeigen/ }));
    expect(screen.getByTestId("graph-counts").textContent).not.toBe(before);
  });

  it("opens a node on click: items, notes and cards", async () => {
    const user = userEvent.setup();
    const { history } = renderApp(`/graph?node=${AUTOPOIESIS}`);
    const canvas = await screen.findByTestId("fake-canvas");

    await user.click(
      within(canvas).getByRole("button", { name: /canvas Soziale Systeme bestehen/ }),
    );
    await waitFor(() => expect(history.location.pathname).toBe(`/items/${LUHMANN}`));
    expect(history.location.search).toMatch(/tab=read/);
    expect(history.location.search).toMatch(/card=c_/);
  });

  it("opens an item from the node list", async () => {
    const user = userEvent.setup();
    const { history } = renderApp(`/graph?node=${AUTOPOIESIS}`);
    await user.click(
      await screen.findByRole("button", { name: /Soziale Systeme: Grundriss.* öffnen/ }),
    );
    await waitFor(() => expect(history.location.pathname).toBe(`/items/${LUHMANN}`));
    expect(await screen.findByRole("heading", { level: 1, name: /Soziale Systeme/ })).toBeVisible();
  });

  it("opens a note on click", async () => {
    const user = userEvent.setup();
    const { history } = renderApp(`/graph?node=${AUTOPOIESIS}`);
    await user.click(
      await screen.findByRole("button", { name: "Das Zettelkasten-Prinzip öffnen" }),
    );
    await waitFor(() => expect(history.location.pathname).toBe("/notes/n_0000000000000002"));
  });

  it("widens the graph with the depth control", async () => {
    const user = userEvent.setup();
    const { history } = renderApp(`/graph?node=n_0000000000000002`);
    await screen.findByTestId("fake-canvas");
    const first = screen.getByTestId("graph-counts").textContent;
    await user.click(screen.getByRole("button", { name: "2" }));
    await waitFor(() => expect(history.location.search).toMatch(/depth=2/));
    await waitFor(() => expect(screen.getByTestId("graph-counts").textContent).not.toBe(first));
  });

  it("speaks English when asked to", async () => {
    renderApp(`/graph?node=${AUTOPOIESIS}`, undefined, { lang: "en" });
    expect(await screen.findByRole("complementary", { name: "Filters and nodes" })).toBeVisible();
    expect(screen.getByText("Connection type")).toBeVisible();
    expect(await screen.findByTestId("graph-counts")).toHaveTextContent(/nodes, \d+ connections/);
  });
});
