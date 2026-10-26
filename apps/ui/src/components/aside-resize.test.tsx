import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderApp } from "../test-utils";
import { ASIDE_WIDTH_KEY, asideMax, clampAside } from "./aside-resize";

const readVar = () => document.documentElement.style.getPropertyValue("--aside-width");

async function handle() {
  return screen.findByRole("separator", { name: "Breite der rechten Spalte" });
}

function setWindowWidth(width: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
}

beforeEach(() => setWindowWidth(1280));
afterEach(() => localStorage.clear());

describe("limits", () => {
  it("caps the column at 60 percent of the window and keeps 480px for the main area", () => {
    expect(asideMax(1280, 0)).toBe(768);
    expect(asideMax(1280, 1100)).toBe(620);
    expect(asideMax(400, 0)).toBe(280);
    expect(asideMax(900, 500)).toBe(280);
  });

  it("clamps into the range", () => {
    expect(clampAside(100, 700)).toBe(280);
    expect(clampAside(900, 700)).toBe(700);
    expect(clampAside(400.4, 700)).toBe(400);
  });
});

describe("resizable right column", () => {
  it("describes itself as a vertical separator at the default width", async () => {
    renderApp("/items/luhmann1984soziale");
    const sep = await handle();
    expect(sep).toHaveAttribute("aria-orientation", "vertical");
    expect(sep).toHaveAttribute("aria-valuenow", "360");
    expect(sep).toHaveAttribute("aria-valuemin", "280");
    expect(sep).toHaveAttribute("aria-valuemax", "768");
    expect(sep).toHaveAttribute("tabindex", "0");
    expect(readVar()).toBe("360px");
  });

  it("moves by 16px with the arrow keys and by 64px with shift", async () => {
    const user = userEvent.setup();
    renderApp("/items/luhmann1984soziale");
    const sep = await handle();
    sep.focus();
    await user.keyboard("{ArrowLeft}");
    expect(sep).toHaveAttribute("aria-valuenow", "376");
    await user.keyboard("{Shift>}{ArrowLeft}{/Shift}");
    expect(sep).toHaveAttribute("aria-valuenow", "440");
    await user.keyboard("{ArrowRight}");
    expect(sep).toHaveAttribute("aria-valuenow", "424");
    await user.keyboard("{Shift>}{ArrowRight}{/Shift}");
    expect(sep).toHaveAttribute("aria-valuenow", "360");
    expect(readVar()).toBe("360px");
  });

  it("jumps to the limits with Home and End and never passes them", async () => {
    const user = userEvent.setup();
    renderApp("/items/luhmann1984soziale");
    const sep = await handle();
    sep.focus();
    await user.keyboard("{Home}");
    expect(sep).toHaveAttribute("aria-valuenow", "280");
    await user.keyboard("{ArrowRight}");
    expect(sep).toHaveAttribute("aria-valuenow", "280");
    await user.keyboard("{End}");
    expect(sep).toHaveAttribute("aria-valuenow", "768");
    await user.keyboard("{ArrowLeft}");
    expect(sep).toHaveAttribute("aria-valuenow", "768");
    expect(readVar()).toBe("768px");
  });

  it("stores the width, restores it on start and resets on double click", async () => {
    const user = userEvent.setup();
    const first = renderApp("/items/luhmann1984soziale");
    const sep = await handle();
    sep.focus();
    await user.keyboard("{Shift>}{ArrowLeft}{/Shift}");
    expect(localStorage.getItem(ASIDE_WIDTH_KEY)).toBe("424");
    first.unmount();

    renderApp("/items/luhmann1984soziale");
    const again = await handle();
    expect(again).toHaveAttribute("aria-valuenow", "424");
    expect(readVar()).toBe("424px");
    await user.dblClick(again);
    expect(again).toHaveAttribute("aria-valuenow", "360");
    expect(localStorage.getItem(ASIDE_WIDTH_KEY)).toBeNull();
    expect(readVar()).toBe("360px");
  });

  it("clamps a stored width to the window and gives it back when the window grows", async () => {
    localStorage.setItem(ASIDE_WIDTH_KEY, "700");
    setWindowWidth(900);
    renderApp("/items/luhmann1984soziale");
    const sep = await handle();
    expect(sep).toHaveAttribute("aria-valuenow", "540");
    expect(readVar()).toBe("540px");
    setWindowWidth(1600);
    fireEvent(window, new Event("resize"));
    expect(await screen.findByRole("separator")).toHaveAttribute("aria-valuenow", "700");
    expect(localStorage.getItem(ASIDE_WIDTH_KEY)).toBe("700");
  });

  it("resizes by dragging and does not select text meanwhile", async () => {
    renderApp("/items/luhmann1984soziale");
    const sep = await handle();
    fireEvent.pointerDown(sep, { button: 0, clientX: 900, pointerId: 1 });
    expect(document.body.style.userSelect).toBe("none");
    fireEvent.pointerMove(sep, { clientX: 800, pointerId: 1 });
    expect(readVar()).toBe("460px");
    fireEvent.pointerMove(sep, { clientX: 0, pointerId: 1 });
    expect(readVar()).toBe("768px");
    fireEvent.pointerMove(sep, { clientX: 850, pointerId: 1 });
    fireEvent.pointerUp(sep, { clientX: 850, pointerId: 1 });
    expect(document.body.style.userSelect).toBe("");
    expect(sep).toHaveAttribute("aria-valuenow", "410");
    expect(localStorage.getItem(ASIDE_WIDTH_KEY)).toBe("410");
  });
});
