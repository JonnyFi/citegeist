import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
  // the library remembers its sort; a test must not inherit the one of the test before
  localStorage.clear();
});

// The UI follows the system language and falls back to English. The tests were written against
// German, so jsdom's system speaks German unless a test sets another list.
Object.defineProperty(window.navigator, "languages", {
  configurable: true,
  get: () => ["de-DE", "de", "en-US"],
});

// jsdom lacks these; Base UI popups and the router use them.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub;
Element.prototype.scrollIntoView ??= () => {};
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.releasePointerCapture ??= () => {};
window.scrollTo = () => {};
// jsdom has no layout, so ranges have no rectangles. The reader asks for them to place highlights.
const noRects = { length: 0, item: () => null, [Symbol.iterator]: () => [][Symbol.iterator]() };
Range.prototype.getClientRects ??= () => noRects as unknown as DOMRectList;
Range.prototype.getBoundingClientRect ??= () => new DOMRect(0, 0, 0, 0);
