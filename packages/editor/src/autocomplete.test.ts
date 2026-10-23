import "./test-dom";
import { CompletionContext } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { filterSuggestions, wikiLinkSource } from "./autocomplete";
import { configFacet } from "./config";
import { createNoteEditor, type NoteEditor } from "./editor";
import { DEFAULT_LABELS, type Suggestion, type WikiLinkProvider } from "./types";

const ALL: Suggestion[] = [
  { kind: "item", target: "luhmann1984soziale", label: "Soziale Systeme", detail: "Luhmann 1984" },
  { kind: "item", target: "maturana1980autopoiesis", label: "Autopoiesis and Cognition" },
  { kind: "note", target: "autopoiesis-erklaert", label: "Autopoiesis erklärt die Stabilität" },
  {
    kind: "card",
    target: "c_01JB8Z3Q",
    label: "Das System beobachtet sich selbst.",
    detail: "S. 31",
  },
];

const provider: WikiLinkProvider = {
  suggest: (query, { embed }) =>
    filterSuggestions(embed ? ALL.filter((s) => s.kind === "card") : ALL, query),
  resolve: () => undefined,
};

async function complete(doc: string, pos = doc.length) {
  const state = EditorState.create({
    doc,
    extensions: [configFacet.of({ provider, labels: DEFAULT_LABELS, onOpenLink: undefined })],
  });
  return wikiLinkSource(new CompletionContext(state, pos, true));
}

describe("filterSuggestions", () => {
  it("puts target prefixes before title prefixes before substrings", () => {
    const out = filterSuggestions(ALL, "auto").map((s) => s.target);
    expect(out).toEqual(["autopoiesis-erklaert", "maturana1980autopoiesis"]);
    expect(filterSuggestions(ALL, "soz").map((s) => s.target)).toEqual(["luhmann1984soziale"]);
  });

  it("matches the detail line and ignores case", () => {
    expect(filterSuggestions(ALL, "LUHMANN 19").map((s) => s.target)).toEqual([
      "luhmann1984soziale",
    ]);
    expect(filterSuggestions(ALL, "nichts davon")).toEqual([]);
  });

  it("returns everything for an empty query, capped by the limit", () => {
    expect(filterSuggestions(ALL, "")).toHaveLength(4);
    expect(filterSuggestions(ALL, "", 2)).toHaveLength(2);
  });
});

describe("wiki-link completion source", () => {
  it("offers citekeys, notes and cards after [[", async () => {
    const r = await complete("Siehe [[");
    expect(r?.from).toBe(8);
    expect(r?.options.map((o) => o.label)).toEqual([
      "luhmann1984soziale",
      "maturana1980autopoiesis",
      "autopoiesis-erklaert",
      "c_01JB8Z3Q",
    ]);
    expect(r?.options.map((o) => o.type)).toEqual(["item", "item", "note", "card"]);
  });

  it("narrows by the typed text", async () => {
    const r = await complete("[[sys");
    expect(r?.from).toBe(2);
    expect(r?.options.map((o) => o.label)).toEqual(["luhmann1984soziale", "c_01JB8Z3Q"]);
  });

  it("offers only cards after ![[", async () => {
    const r = await complete("![[");
    expect(r?.from).toBe(3);
    expect(r?.options.map((o) => o.label)).toEqual(["c_01JB8Z3Q"]);
  });

  it("does not trigger without [[, after ]], or behind an alias or anchor", async () => {
    expect(await complete("Text [wort")).toBeNull();
    expect(await complete("[[a]] danach")).toBeNull();
    expect(await complete("[[a|b")).toBeNull();
    expect(await complete("[[a#b")).toBeNull();
    expect(await complete("[[a\nb")).toBeNull();
  });

  it("does nothing without a provider", async () => {
    const state = EditorState.create({ doc: "[[" });
    expect(await wikiLinkSource(new CompletionContext(state, 2, true))).toBeNull();
  });
});

const mounted: NoteEditor[] = [];
afterEach(() => {
  for (const e of mounted.splice(0)) e.destroy();
  document.body.replaceChildren();
});

function mount(doc: string): NoteEditor {
  const editor = createNoteEditor({
    parent: document.body.appendChild(document.createElement("div")),
    value: doc,
    provider,
  });
  mounted.push(editor);
  return editor;
}

describe("accepting a completion", () => {
  async function accept(doc: string, cursor: number, pick: number) {
    const editor = mount(doc);
    editor.view.dispatch({ selection: { anchor: cursor } });
    const result = await wikiLinkSource(new CompletionContext(editor.view.state, cursor, true));
    const option = result?.options[pick];
    if (!result || !option || typeof option.apply !== "function") throw new Error("no option");
    option.apply(editor.view, option, result.from, cursor);
    return editor;
  }

  it("closes the link when no brackets follow", async () => {
    const editor = await accept("Siehe [[luh", 11, 0);
    expect(editor.getValue()).toBe("Siehe [[luhmann1984soziale]]");
    expect(editor.view.state.selection.main.head).toBe(editor.getValue().length);
  });

  it("reuses closing brackets that are already there", async () => {
    const editor = await accept("Siehe [[luh]] weiter", 11, 0);
    expect(editor.getValue()).toBe("Siehe [[luhmann1984soziale]] weiter");
    expect(editor.view.state.selection.main.head).toBe("Siehe [[luhmann1984soziale]]".length);
  });

  it("completes an embed with a card id", async () => {
    const editor = await accept("![[", 3, 0);
    expect(editor.getValue()).toBe("![[c_01JB8Z3Q]]");
  });
});

describe("typing [[", () => {
  function type(editor: NoteEditor, pos: number, text: string): boolean {
    const { view } = editor;
    view.dispatch({ selection: { anchor: pos } });
    const insert = () => view.state.update({ changes: { from: pos, insert: text } });
    return view.state.facet(EditorView.inputHandler).some((h) => h(view, pos, pos, text, insert));
  }

  it("completes the pair and leaves the cursor inside", () => {
    const editor = mount("Siehe [");
    expect(type(editor, 7, "[")).toBe(true);
    expect(editor.getValue()).toBe("Siehe [[]]");
    expect(editor.view.state.selection.main.head).toBe(8);
  });

  it("leaves a single [ and existing pairs alone", () => {
    expect(type(mount("Siehe "), 6, "[")).toBe(false);
    expect(type(mount("[[]]"), 2, "[")).toBe(false);
  });
});
