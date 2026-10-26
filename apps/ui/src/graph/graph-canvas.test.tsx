import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import GraphCanvas from "./graph-canvas";

describe("graph canvas", () => {
  it("says so when WebGL is missing instead of failing", async () => {
    render(
      <GraphCanvas
        view={{
          nodes: [{ id: "luhmann", kind: "item", label: "Luhmann", cards: 1 }],
          edges: [],
          members: [],
        }}
        positions={new Map()}
        edgeLabel={() => ""}
        labelled={new Set()}
        onNode={vi.fn()}
        onNodeMenu={vi.fn()}
        onEdge={vi.fn()}
        onStage={vi.fn()}
      />,
    );
    expect(await screen.findByText(/braucht WebGL/)).toBeVisible();
    expect(screen.getByRole("img", { name: "Graph der Verbindungen" })).toBeInTheDocument();
  });
});
