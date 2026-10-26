import "./test-dom";
import { undo } from "@codemirror/commands";
import { afterEach, describe, expect, it } from "vitest";
import type { ClusterRef } from "./clusters";
import { setFocusEffect } from "./config";
import { createNoteEditor, type NoteEditor } from "./editor";
import type { CitationProvider } from "./types";

const KNOWN = new Set(["a", "b"]);

function provider(prefix = "(", seen?: ClusterRef[][]): CitationProvider {
  return {
    suggest: () => [],
    resolve: (key) => (KNOWN.has(key) ? { title: `Title ${key}` } : undefined),
    format: (refs) => {
      seen?.push(refs);
      return `${prefix}${refs.map((r) => `${r.key}${r.locator ? ` ${r.locator}` : ""}`).join("; ")})`;
    },
  };
}

const mounted: NoteEditor[] = [];
afterEach(() => {
  for (const e of mounted.splice(0)) e.destroy();
  document.body.replaceChildren();
});

function mount(doc: string, citations: CitationProvider | undefined = provider()) {
  const editor = createNoteEditor({
    parent: document.body.appendChild(document.createElement("div")),
    value: doc,
    ...(citations ? { citations } : {}),
  });
  mounted.push(editor);
  return editor;
}

const focus = (editor: NoteEditor, on = true) =>
  editor.view.dispatch({ effects: setFocusEffect.of(on) });
const chips = (editor: NoteEditor) =>
  [...editor.view.contentDOM.querySelectorAll(".cm-cite-chip")].map((el) => el.textContent);
const text = (editor: NoteEditor) => editor.view.contentDOM.textContent ?? "";

describe("citation chips", () => {
  it("shows the in-text form instead of the Pandoc text while the editor is unfocused", () => {
    const editor = mount("Das gilt [vgl. @a, S. 12; @b] sicher.");
    expect(chips(editor)).toEqual(["(a 12; b)"]);
    expect(text(editor)).toBe("Das gilt (a 12; b) sicher.");
    expect(editor.getValue()).toBe("Das gilt [vgl. @a, S. 12; @b] sicher.");
    expect(editor.view.contentDOM.querySelector(".cm-cite")).toBeNull();
  });

  it("hands the parsed refs to format", () => {
    const seen: ClusterRef[][] = [];
    mount("[vgl. @a, S. 12; -@b]", provider("(", seen));
    expect(seen.at(-1)).toEqual([
      { key: "a", prefix: "vgl.", locator: "12", label: "page" },
      { key: "b", suppressAuthor: true },
    ]);
  });

  it("gives the chip the raw text as title and label", () => {
    const editor = mount("[@a, S. 3]");
    const chip = editor.view.contentDOM.querySelector(".cm-cite-chip");
    expect(chip?.getAttribute("title")).toBe("[@a, S. 3]");
    expect(chip?.getAttribute("aria-label")).toBe("[@a, S. 3]");
    expect(chip?.getAttribute("role")).toBe("button");
  });

  it("shows the raw text with the marks while the cursor is inside or touches the cluster", () => {
    const editor = mount("Das gilt [vgl. @a, S. 12] sicher.");
    focus(editor);
    editor.view.dispatch({ selection: { anchor: 0 } });
    expect(chips(editor)).toEqual(["(a 12)"]);
    editor.view.dispatch({ selection: { anchor: 15 } });
    expect(chips(editor)).toEqual([]);
    expect(text(editor)).toBe("Das gilt [vgl. @a, S. 12] sicher.");
    expect(editor.view.contentDOM.querySelector(".cm-cite")?.textContent).toBe("a");
    editor.view.dispatch({ selection: { anchor: 0 } });
    expect(chips(editor)).toEqual(["(a 12)"]);
    focus(editor, false);
    editor.view.dispatch({ selection: { anchor: 15 } });
    expect(chips(editor)).toEqual(["(a 12)"]);
  });

  it("leaves the brackets of the cluster unstyled by the live preview", () => {
    const editor = mount("[vgl. @a, S. 1]");
    expect(text(editor)).toBe("(a 1)");
    focus(editor);
    editor.view.dispatch({ selection: { anchor: 3 } });
    expect(text(editor)).toBe("[vgl. @a, S. 1]");
    expect(editor.view.contentDOM.querySelector(".cm-link")).toBeNull();
  });

  it("shows no chip for unknown keys, unparsed clusters, bare keys or without format", () => {
    expect(chips(mount("[@a; @nobody]"))).toEqual([]);
    expect(chips(mount("[@a, im Anhang]"))).toEqual([]);
    expect(chips(mount("Nach @a gilt das."))).toEqual([]);
    const plain = mount("[@a]", {
      suggest: () => [],
      resolve: () => ({ title: "x" }),
    });
    expect(chips(plain)).toEqual([]);
    const later = mount("[@a]", {
      suggest: () => [],
      resolve: () => ({ title: "x" }),
      format: () => undefined,
    });
    expect(chips(later)).toEqual([]);
    expect(text(later)).toBe("[@a]");
  });

  it("keeps the marks on keys of clusters that show no chip", () => {
    const editor = mount("[@a; @nobody] und @b");
    expect(
      [...editor.view.contentDOM.querySelectorAll(".cm-cite")].map((el) => el.textContent),
    ).toEqual(["a", "nobody", "b"]);
  });

  it("changes the chip text at once when configure swaps the provider, and on refresh", () => {
    const editor = mount("[@a]");
    expect(chips(editor)).toEqual(["(a)"]);
    editor.configure({ citations: provider("<") });
    expect(chips(editor)).toEqual(["<a)"]);
    let ready = false;
    editor.configure({
      citations: {
        suggest: () => [],
        resolve: () => ({ title: "x" }),
        format: () => (ready ? "(Ready)" : undefined),
      },
    });
    expect(chips(editor)).toEqual([]);
    ready = true;
    editor.refresh();
    expect(chips(editor)).toEqual(["(Ready)"]);
  });

  it("turns into source text when the chip is pressed", () => {
    const editor = mount("Vorher [@a, S. 3] nachher");
    const chip = editor.view.contentDOM.querySelector(".cm-cite-chip");
    if (!chip) throw new Error("no chip");
    chip.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    expect(editor.view.state.selection.main.head).toBe(8);
    expect(chips(editor)).toEqual([]);
    expect(text(editor)).toBe("Vorher [@a, S. 3] nachher");
  });
});

describe("replaceRanges", () => {
  it("applies several changes as one undoable edit that reports onChange", () => {
    const seen: string[] = [];
    const editor = createNoteEditor({
      parent: document.body.appendChild(document.createElement("div")),
      value: "eins [@a] zwei [@b] drei",
      onChange: (v) => seen.push(v),
    });
    mounted.push(editor);
    editor.replaceRanges([
      { from: 5, to: 9, insert: "[@a, S. 1]" },
      { from: 15, to: 19, insert: "" },
    ]);
    expect(editor.getValue()).toBe("eins [@a, S. 1] zwei  drei");
    expect(seen).toEqual(["eins [@a, S. 1] zwei  drei"]);
    undo(editor.view);
    expect(editor.getValue()).toBe("eins [@a] zwei [@b] drei");
  });

  it("does nothing for an empty list", () => {
    const editor = mount("Text", undefined);
    editor.replaceRanges([]);
    expect(editor.getValue()).toBe("Text");
  });
});
