import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Neighbors } from "../connections/model";
import GraphCanvas from "./graph-canvas";

const data: Neighbors = {
  nodes: [
    { id: "n_1", kind: "note", label: "Notiz" },
    { id: "luhmann", kind: "item", label: "Luhmann" },
  ],
  edges: [{ from: "n_1", to: "luhmann", rel: "supports", status: "accepted" }],
};

describe("graph canvas", () => {
  it("says so when WebGL is missing instead of failing", async () => {
    render(<GraphCanvas data={data} center="n_1" onOpen={vi.fn()} />);
    expect(await screen.findByText(/braucht WebGL/)).toBeVisible();
    expect(screen.getByRole("img", { name: "Graph der Verbindungen" })).toBeInTheDocument();
  });
});
