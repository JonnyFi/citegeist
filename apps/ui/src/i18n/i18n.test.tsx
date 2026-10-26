import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { createReflowFixtures, renderApp } from "../test-utils";
import { de } from "./de";
import { en } from "./en";
import { pickLang, systemLang, translator } from "./index";

afterEach(() => localStorage.clear());

describe("catalogs", () => {
  it("define the same keys in both languages", () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(de).sort());
  });

  it("keep placeholders in step", () => {
    const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const key of Object.keys(de) as Array<keyof typeof de>) {
      expect(vars(en[key]), key).toEqual(vars(de[key]));
    }
  });

  it("contain no em dashes", () => {
    for (const text of [...Object.values(de), ...Object.values(en)])
      expect(text).not.toContain("—");
  });

  it("pick plural forms by count", () => {
    const de1 = translator("de");
    expect(de1.tn("items.count", 1)).toBe("1 Quelle");
    expect(de1.tn("items.count", 3)).toBe("3 Quellen");
    expect(translator("en").tn("items.count", 0)).toBe("0 items");
  });
});

describe("system language", () => {
  const setLanguages = (languages: string[]) =>
    Object.defineProperty(window.navigator, "languages", {
      configurable: true,
      get: () => languages,
    });
  afterEach(() => setLanguages(["de-DE", "de", "en-US"]));

  it("picks the first offered language of a preference list", () => {
    expect(pickLang(["de-AT", "en"])).toBe("de");
    expect(pickLang(["de_DE"])).toBe("de");
    expect(pickLang(["en-GB", "de"])).toBe("en");
    expect(pickLang(["fr-FR", "de-DE"])).toBe("de");
  });

  it("falls back to English for any other language", () => {
    expect(pickLang(["fr-FR", "ja"])).toBe("en");
    expect(pickLang([])).toBe("en");
  });

  it("reads the list from the browser engine", () => {
    setLanguages(["fr-FR", "en-US"]);
    expect(systemLang()).toBe("en");
    setLanguages(["de-CH"]);
    expect(systemLang()).toBe("de");
  });

  it("starts in the system language and lets a stored choice win", async () => {
    setLanguages(["en-US"]);
    const view = renderApp("/", undefined, { lang: "system" });
    expect(await screen.findByRole("link", { name: "Projects" })).toBeVisible();
    view.unmount();
    localStorage.setItem("citegeist.lang", "de");
    renderApp("/", undefined, { lang: "system" });
    expect(await screen.findByRole("link", { name: "Projekte" })).toBeVisible();
  });
});

describe("language switching", () => {
  it("shows German by default", async () => {
    renderApp("/");
    expect(await screen.findByRole("link", { name: "Projekte" })).toBeVisible();
    expect(document.documentElement.lang).toBe("de");
  });

  it("shows English when asked for", async () => {
    renderApp("/", undefined, { lang: "en" });
    expect(await screen.findByRole("link", { name: "Projects" })).toBeVisible();
    expect(await screen.findByText("Reading")).toBeVisible();
  });

  it("switches the whole UI with the toggle and remembers the choice", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await user.click(await screen.findByRole("button", { name: "English" }));
    expect(await screen.findByRole("link", { name: "Projects" })).toBeVisible();
    expect(await screen.findByRole("heading", { level: 1, name: "Library" })).toBeVisible();
    expect(document.documentElement.lang).toBe("en");
    expect(localStorage.getItem("citegeist.lang")).toBe("en");

    await user.click(screen.getByRole("button", { name: "Deutsch" }));
    await waitFor(() => expect(screen.getByRole("link", { name: "Projekte" })).toBeVisible());
  });

  it("translates the reader and card panel", async () => {
    renderApp("/items/luhmann1984soziale?tab=read", createReflowFixtures(), { lang: "en" });
    expect(await screen.findByText("Cards")).toBeVisible();
    expect(await screen.findByRole("region", { name: "Check page numbers" })).toBeVisible();
  });
});
