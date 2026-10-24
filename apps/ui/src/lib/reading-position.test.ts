import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadReadingPosition,
  measureReading,
  restoreReading,
  saveReadingPosition,
  trackReading,
} from "./reading-position";

afterEach(() => {
  localStorage.clear();
  vi.useRealTimers();
});

/** A scroller with three pages of 100px. jsdom has no layout, so the rectangles are set by hand. */
function reader(top = 0) {
  const host = document.createElement("div");
  const scroller = document.createElement("div");
  scroller.setAttribute("data-testid", "reflow-scroll");
  host.append(scroller);
  const pages = [0, 1, 2].map((i) => {
    const page = document.createElement("div");
    page.dataset.page = String(i);
    page.dataset.label = `S. ${i + 10}`;
    scroller.append(page);
    return page;
  });
  const layout = (scrollTop: number) => {
    scroller.getBoundingClientRect = () => new DOMRect(0, 0, 400, 100);
    pages.forEach((p, i) => {
      p.getBoundingClientRect = () => new DOMRect(0, i * 100 - scrollTop, 400, 100);
    });
  };
  Object.defineProperty(scroller, "scrollHeight", { configurable: true, value: 300 });
  Object.defineProperty(scroller, "clientHeight", { configurable: true, value: 100 });
  scroller.scrollTop = top;
  layout(top);
  document.body.append(host);
  return { host, scroller, pages, layout };
}

describe("reading position", () => {
  it("stores and reads back a position", () => {
    saveReadingPosition("a2020", {
      page: 3,
      label: "S. 13",
      ratio: 0.5,
      at: "2026-10-24T09:00:00Z",
    });
    expect(loadReadingPosition("a2020")).toMatchObject({ page: 3, label: "S. 13", ratio: 0.5 });
    expect(loadReadingPosition("other")).toBeNull();
  });

  it("ignores a broken entry", () => {
    localStorage.setItem("citegeist.reading.a2020", "{nope");
    expect(loadReadingPosition("a2020")).toBeNull();
  });

  it("measures the first page that is still in view", () => {
    const { scroller } = reader(150);
    expect(measureReading(scroller)).toEqual({ page: 1, label: "S. 11", ratio: 0.75 });
  });

  it("falls back to the page labels of the document", () => {
    const { scroller, pages } = reader(0);
    for (const p of pages) delete p.dataset.label;
    expect(measureReading(scroller, (page) => `L${page}`)).toMatchObject({ page: 0, label: "L0" });
  });
});

describe("tracking and restoring", () => {
  beforeEach(() => vi.useFakeTimers());

  it("saves the position a moment after the reader stopped scrolling", () => {
    const { host, scroller, layout } = reader(0);
    const stop = trackReading(host, "a2020");
    scroller.scrollTop = 120;
    layout(120);
    scroller.dispatchEvent(new Event("scroll"));
    expect(loadReadingPosition("a2020")).toBeNull();
    vi.advanceTimersByTime(500);
    expect(loadReadingPosition("a2020")).toMatchObject({ page: 1, label: "S. 11" });

    stop();
    scroller.scrollTop = 250;
    layout(250);
    scroller.dispatchEvent(new Event("scroll"));
    vi.advanceTimersByTime(500);
    expect(loadReadingPosition("a2020")).toMatchObject({ page: 1 });
  });

  it("scrolls to the stored page once the view has rendered it", () => {
    const { host, scroller, pages, layout } = reader(0);
    pages[2]?.remove();
    const stop = restoreReading(host, { page: 2, ratio: 0.5, at: "" }, 20, 100);
    vi.advanceTimersByTime(300);
    expect(scroller.scrollTop).toBe(0);
    scroller.append(pages[2] as HTMLElement);
    layout(0);
    vi.advanceTimersByTime(100);
    expect(scroller.scrollTop).toBe(200);
    stop();
  });

  it("falls back to the share of the height when no page is found", () => {
    const { host, scroller, pages } = reader(0);
    for (const p of pages) p.remove();
    restoreReading(host, { page: 2, ratio: 0.5, at: "" }, 3, 100);
    vi.advanceTimersByTime(400);
    expect(scroller.scrollTop).toBe(100);
  });
});
