import { describe, expect, it } from "vitest";
import { decideTarget, parseEditorState, type TargetInput } from "./target.js";

const own = "app.citegeist.desktop";
const editor = { project: "thesis", text: "chapter-1", lang: "de" };
const base: TargetInput = {
  frontBundleId: own,
  ownBundleId: own,
  mainWindowFocused: true,
  editor,
};

describe("decideTarget", () => {
  it("inserts into the editor when citegeist is in front, focused, with a text open", () => {
    expect(decideTarget(base)).toEqual({
      type: "text",
      project: "thesis",
      text: "chapter-1",
      lang: "de",
    });
  });

  it("leaves the language out when the text has none", () => {
    const target = decideTarget({ ...base, editor: { project: "thesis", text: "chapter-1" } });
    expect(target).toEqual({ type: "text", project: "thesis", text: "chapter-1" });
    expect("lang" in target).toBe(false);
  });

  it("pastes when another app is in front", () => {
    expect(decideTarget({ ...base, frontBundleId: "com.microsoft.Word" })).toEqual({
      type: "external",
    });
  });

  it("pastes when the front app is unknown but citegeist's id is known", () => {
    expect(decideTarget({ ...base, frontBundleId: undefined })).toEqual({ type: "external" });
  });

  it("pastes when citegeist is in front but no text is open", () => {
    expect(decideTarget({ ...base, editor: null })).toEqual({ type: "external" });
  });

  it("pastes when a text is open but the main window has no focus or is gone", () => {
    expect(decideTarget({ ...base, mainWindowFocused: false })).toEqual({ type: "external" });
  });

  it("ignores an editor state that cannot address a text", () => {
    expect(decideTarget({ ...base, editor: { project: "", text: "chapter-1" } })).toEqual({
      type: "external",
    });
    expect(decideTarget({ ...base, editor: { project: "thesis", text: "" } })).toEqual({
      type: "external",
    });
  });

  it("lets the window focus decide where no platform can name the front app", () => {
    const blind = { ...base, frontBundleId: undefined, ownBundleId: undefined };
    expect(decideTarget(blind).type).toBe("text");
    expect(decideTarget({ ...blind, mainWindowFocused: false }).type).toBe("external");
    // Own id unknown but another app named in front: that app is not citegeist.
    expect(decideTarget({ ...blind, frontBundleId: "com.apple.Safari" }).type).toBe("external");
  });
});

describe("parseEditorState", () => {
  it("accepts a project, a text and an optional language", () => {
    expect(parseEditorState({ project: "p", text: "t", lang: "en" })).toEqual({
      project: "p",
      text: "t",
      lang: "en",
    });
    expect(parseEditorState({ project: "p", text: "t" })).toEqual({ project: "p", text: "t" });
  });

  it("treats anything else as no open text", () => {
    for (const bad of [null, undefined, "x", 3, {}, { project: "p" }, { project: 1, text: "t" }]) {
      expect(parseEditorState(bad)).toBeNull();
    }
    expect(parseEditorState({ project: "p", text: "x".repeat(501) })).toBeNull();
    expect(parseEditorState({ project: "p", text: "t", lang: 5 })).toEqual({
      project: "p",
      text: "t",
    });
  });
});
