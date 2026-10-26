import { afterEach, describe, expect, it, vi } from "vitest";
import { createChipFormatter, type RenderCluster } from "./chips";

afterEach(() => vi.useRealTimers());

const cluster = [{ key: "luhmann1984soziale", locator: "31", label: "page" }];

describe("createChipFormatter", () => {
  it("asks the core once for a cluster and reports when the text arrived", async () => {
    const render = vi.fn<RenderCluster>(async () => "(Luhmann, 1984, S. 31)");
    const onUpdate = vi.fn();
    const f = createChipFormatter({ render, style: "apa", locale: "de-DE", onUpdate });
    expect(f.format(cluster)).toBeUndefined();
    expect(f.format(cluster)).toBeUndefined();
    await vi.waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1));
    expect(render).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenCalledWith(cluster, "apa", "de-DE");
    expect(f.format(cluster)).toBe("(Luhmann, 1984, S. 31)");
  });

  it("keeps showing the old text of another style until the new one is in", async () => {
    const stale = new Map<string, string>();
    const apa = createChipFormatter({
      render: async () => "(Luhmann, 1984, S. 31)",
      style: "apa",
      locale: "de-DE",
      onUpdate: () => {},
      stale,
    });
    apa.format(cluster);
    await vi.waitFor(() => expect(apa.format(cluster)).toBe("(Luhmann, 1984, S. 31)"));

    const onUpdate = vi.fn();
    const chicago = createChipFormatter({
      render: async () => "(Luhmann 1984, 31)",
      style: "chicago-author-date",
      locale: "de-DE",
      onUpdate,
      stale,
    });
    expect(chicago.format(cluster)).toBe("(Luhmann, 1984, S. 31)");
    await vi.waitFor(() => expect(onUpdate).toHaveBeenCalled());
    expect(chicago.format(cluster)).toBe("(Luhmann 1984, 31)");
  });

  it("shows the raw syntax for a cluster the core cannot render and does not ask again", async () => {
    const render = vi.fn<RenderCluster>(async () => {
      throw new Error("CITE_UNKNOWN_ITEM");
    });
    const onUpdate = vi.fn();
    const f = createChipFormatter({ render, style: "apa", locale: "de-DE", onUpdate });
    f.format(cluster);
    await vi.waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1));
    expect(f.format(cluster)).toBeUndefined();
    expect(render).toHaveBeenCalledTimes(1);
  });

  it("leaves clusters with a suffix or a suppressed author to the raw syntax", () => {
    const render = vi.fn<RenderCluster>(async () => "x");
    const f = createChipFormatter({ render, style: "apa", locale: "de-DE", onUpdate: () => {} });
    expect(f.format([{ key: "a", suffix: "und passim" }])).toBeUndefined();
    expect(f.format([{ key: "a", suppressAuthor: true }])).toBeUndefined();
    expect(render).not.toHaveBeenCalled();
  });

  it("stops reporting after dispose", async () => {
    const onUpdate = vi.fn();
    const f = createChipFormatter({
      render: async () => "x",
      style: "apa",
      locale: "de",
      onUpdate,
    });
    f.format(cluster);
    f.dispose();
    await new Promise((r) => setTimeout(r, 20));
    expect(onUpdate).not.toHaveBeenCalled();
  });
});
