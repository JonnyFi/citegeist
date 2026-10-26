import { describe, expect, it } from "vitest";
import { languageFromPreferred, mt, setMainLanguage } from "./text.js";

describe("languageFromPreferred", () => {
  it("picks German for any German tag at the front of the list", () => {
    expect(languageFromPreferred(["de-AT", "en-US"])).toBe("de");
    expect(languageFromPreferred(["de_DE"])).toBe("de");
  });

  it("skips languages the app does not offer", () => {
    expect(languageFromPreferred(["fr-FR", "de-DE"])).toBe("de");
  });

  it("falls back to English", () => {
    expect(languageFromPreferred(["fr-FR", "ja"])).toBe("en");
    expect(languageFromPreferred([])).toBe("en");
  });
});

describe("mt", () => {
  it("follows the language set for the main process and fills placeholders", () => {
    setMainLanguage("de");
    expect(mt("about.version", { version: "1.2.3" })).toBe("Version 1.2.3");
    expect(mt("menu.library")).toBe("Bibliothek");
    setMainLanguage("en");
    expect(mt("menu.library")).toBe("Library");
  });

  it("has a German text for every English key", () => {
    for (const key of ["about.openLog", "quickInsert.taken", "library.create.detail"] as const) {
      expect(mt(key, {}, "de")).not.toBe(mt(key, {}, "en"));
    }
  });
});
