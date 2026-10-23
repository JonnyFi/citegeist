import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRemoteCore } from "../lib/core";
import { renderApp } from "../test-utils";

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("settings route", () => {
  it("opens from the sidebar", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await user.click(await screen.findByRole("link", { name: "Einstellungen" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Einstellungen" })).toBeVisible();
    expect(await screen.findAllByTestId("backend")).not.toHaveLength(0);
  });

  it("opens by address", async () => {
    renderApp("/settings", undefined, { lang: "en" });
    expect(await screen.findByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
  });
});

describe("inbox", () => {
  it("takes who and why from items.list", async () => {
    const { calls } = renderApp("/inbox");
    expect(await screen.findAllByTestId("inbox-row")).not.toHaveLength(0);
    expect(calls.some((c) => c.name === "items.get")).toBe(false);
  });
});

describe("remote core", () => {
  it("adds the session token to file paths and leaves other URLs alone", () => {
    vi.stubGlobal(
      "WebSocket",
      class {
        close() {}
      },
    );
    const core = createRemoteCore({
      url: "http://127.0.0.1:4711",
      wsUrl: "ws://127.0.0.1:4711/events?token=t0ken",
      token: "t0ken",
      library: "/lib",
    });
    expect(core.fileUrl("/files/luhmann1984soziale/sources/3f9a1c2e7b4d.pdf")).toBe(
      "http://127.0.0.1:4711/files/luhmann1984soziale/sources/3f9a1c2e7b4d.pdf?token=t0ken",
    );
    expect(core.fileUrl("data:application/pdf;base64,AAAA")).toBe(
      "data:application/pdf;base64,AAAA",
    );
    core.close();
  });
});
