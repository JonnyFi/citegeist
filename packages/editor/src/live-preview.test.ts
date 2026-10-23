import "./test-dom";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import type { Decoration } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { configFacet } from "./config";
import { createNoteEditor, type NoteEditor } from "./editor";
import { buildDecorations, frontmatterOpen, livePreview, setFocusEffect } from "./live-preview";
import { DEFAULT_LABELS, type WikiLinkProvider } from "./types";

const provider: WikiLinkProvider = {
  suggest: () => [],
  resolve: (t) =>
    t === "luhmann1984soziale"
      ? { kind: "item", label: "Soziale Systeme" }
      : t === "zettel"
        ? { kind: "note", label: "Zettel" }
        : undefined,
  card: (id) => ({
    id,
    quote: "Das System beobachtet sich selbst.",
    page: "31",
    citation: "Luhmann 1984",
    kind: "Definition",
  }),
};

interface Found {
  from: number;
  to: number;
  cls: string;
  replace: boolean;
  widget: boolean;
}

function decorations(doc: string, cursor: number | [number, number], withProvider = true): Found[] {
  const state = EditorState.create({
    doc,
    selection: Array.isArray(cursor) ? { anchor: cursor[0], head: cursor[1] } : { anchor: cursor },
    extensions: [
      markdown({ base: markdownLanguage }),
      frontmatterOpen,
      configFacet.of({
        provider: withProvider ? provider : undefined,
        labels: DEFAULT_LABELS,
        onOpenLink: undefined,
      }),
    ],
  });
  const out: Found[] = [];
  const iter = buildDecorations(state).iter();
  while (iter.value) {
    const spec = (iter.value as Decoration).spec as { class?: string; widget?: unknown };
    out.push({
      from: iter.from,
      to: iter.to,
      cls: spec.class ?? "",
      replace: iter.value.point && iter.to > iter.from,
      widget: spec.widget !== undefined,
    });
    iter.next();
  }
  return out;
}

const hidden = (found: Found[]) =>
  found.filter((f) => f.replace && !f.widget).map((f) => [f.from, f.to]);

describe("live preview decorations", () => {
  it("hides heading marks when the cursor is on another line and shows them on the line", () => {
    const doc = "# Titel\n\nText";
    expect(hidden(decorations(doc, doc.length))).toEqual([[0, 2]]);
    expect(hidden(decorations(doc, 3))).toEqual([]);
    expect(decorations(doc, 3).some((f) => f.cls.includes("cm-heading-1"))).toBe(true);
  });

  it("hides emphasis marks only while the cursor is outside the emphasis", () => {
    const doc = "a **fett** b";
    expect(hidden(decorations(doc, 0))).toEqual([
      [2, 4],
      [8, 10],
    ]);
    expect(hidden(decorations(doc, 5))).toEqual([]);
    expect(decorations(doc, 0).some((f) => f.cls === "cm-strong")).toBe(true);
  });

  it("hides the URL part of a link and styles its text", () => {
    const doc = "Siehe [hier](https://example.org) dort";
    const found = decorations(doc, doc.length);
    expect(found.some((f) => f.cls === "cm-link")).toBe(true);
    expect(hidden(found).length).toBeGreaterThan(1);
    expect(hidden(decorations(doc, 8))).toEqual([]);
  });

  it("renders bullets, quotes and checkboxes as widgets away from the cursor", () => {
    const doc = "- eins\n- [ ] zwei\n\n> zitat\n\nEnde";
    const found = decorations(doc, doc.length);
    expect(found.filter((f) => f.widget).length).toBeGreaterThanOrEqual(3);
    expect(found.some((f) => f.cls === "cm-quote")).toBe(true);
  });

  it("folds frontmatter into a block unless the cursor is inside it", () => {
    const doc = "---\nid: n_1\n---\n\nText";
    const folded = decorations(doc, doc.length);
    expect(folded.filter((f) => f.widget && f.from === 0 && f.to === 15)).toHaveLength(1);
    expect(decorations(doc, 0).filter((f) => f.widget && f.to === 15)).toHaveLength(1);
    const open = decorations(doc, 6);
    expect(open.some((f) => f.cls === "cm-frontmatter")).toBe(true);
    expect(open.some((f) => f.widget && f.to === 15)).toBe(false);
  });

  it("styles wiki links by what they resolve to and hides brackets away from the cursor", () => {
    const doc = "[[luhmann1984soziale]] [[zettel|mein Zettel]] [[unbekannt]] x";
    const found = decorations(doc, doc.length);
    expect(found.filter((f) => f.cls.includes("cm-wikilink-item"))).toHaveLength(1);
    expect(found.filter((f) => f.cls.includes("cm-wikilink-note"))).toHaveLength(1);
    expect(found.filter((f) => f.cls.includes("cm-wikilink-missing"))).toHaveLength(1);
    // brackets hidden, and "[[zettel|" for the aliased one
    expect(hidden(found)).toEqual(
      expect.arrayContaining([
        [0, 2],
        [20, 22],
        [23, 32],
        [43, 45],
      ]),
    );
    const raw = decorations(doc, 5);
    expect(raw.some((f) => f.cls.includes("cm-wikilink-raw"))).toBe(true);
  });

  it("does not treat wiki links as Markdown links and ignores them in code", () => {
    const doc = "[[zettel]] und `[[zettel]]`\n\n```\n[[zettel]]\n```\n";
    const found = decorations(doc, doc.length);
    expect(found.filter((f) => f.cls.includes("cm-wikilink"))).toHaveLength(1);
    expect(found.some((f) => f.cls === "cm-link")).toBe(false);
  });

  it("renders ![[c_...]] as an embedded card widget and shows the source under the cursor", () => {
    const doc = "Davor\n\n![[c_01JB8Z3Q]]\n\nDanach";
    const away = decorations(doc, 0);
    const at = doc.indexOf("![[");
    expect(away.filter((f) => f.widget && f.from === at && f.to === at + 15)).toHaveLength(1);
    const on = decorations(doc, at + 4);
    expect(on.some((f) => f.widget && f.from === at)).toBe(false);
    expect(on.some((f) => f.cls.includes("cm-wikilink-raw"))).toBe(true);
  });

  it("treats embeds as links when the host cannot render cards", () => {
    const doc = "![[c_01JB8Z3Q]] x";
    const found = decorations(doc, doc.length, false);
    expect(found.some((f) => f.widget)).toBe(false);
  });
});

describe("live preview in the DOM", () => {
  const mounted: NoteEditor[] = [];
  afterEach(() => {
    for (const e of mounted.splice(0)) e.destroy();
    document.body.replaceChildren();
  });
  function mount(value: string, onOpenLink?: (e: unknown) => void): NoteEditor {
    const editor = createNoteEditor({
      parent: document.body.appendChild(document.createElement("div")),
      value,
      provider,
      ...(onOpenLink ? { onOpenLink } : {}),
    });
    mounted.push(editor);
    return editor;
  }

  const focus = (editor: NoteEditor) => editor.view.dispatch({ effects: setFocusEffect.of(true) });

  it("shows rendered text without syntax and reveals it when the cursor arrives", () => {
    const editor = mount("Text\n\n# Titel mit **fett**");
    focus(editor);
    editor.view.dispatch({ selection: { anchor: 0 } });
    const text = editor.view.contentDOM.textContent ?? "";
    expect(text).toContain("Titel mit fett");
    expect(text).not.toContain("#");
    expect(text).not.toContain("**");
    editor.view.dispatch({ selection: { anchor: editor.view.state.doc.length - 2 } });
    expect(editor.view.contentDOM.textContent).toContain("**fett**");
  });

  it("renders everything, even under the cursor, while the editor has no focus", () => {
    const editor = mount("# Titel mit **fett**");
    editor.view.dispatch({ selection: { anchor: 5 } });
    expect(editor.view.contentDOM.textContent).not.toContain("#");
    expect(editor.view.contentDOM.textContent).not.toContain("**");
    focus(editor);
    expect(editor.view.contentDOM.textContent).toContain("# Titel");
    editor.view.dispatch({ effects: setFocusEffect.of(false) });
    expect(editor.view.contentDOM.textContent).not.toContain("#");
  });

  it("renders the embedded card with quote, citation and page", () => {
    const editor = mount("![[c_01JB8Z3Q]]\n\nText");
    focus(editor);
    editor.view.dispatch({ selection: { anchor: editor.view.state.doc.length } });
    const card = editor.view.contentDOM.querySelector(".cm-card-embed");
    expect(card?.textContent).toContain("Das System beobachtet sich selbst.");
    expect(card?.textContent).toContain("Luhmann 1984");
    expect(card?.textContent).toContain("p. 31");
  });

  it("renders a card that the provider delivers later", async () => {
    const late: WikiLinkProvider = {
      ...provider,
      card: (id) => Promise.resolve({ id, quote: "Später da." }),
    };
    const editor = createNoteEditor({
      parent: document.body.appendChild(document.createElement("div")),
      value: "![[c_01JB8Z3Q]]\n\nText",
      provider: late,
    });
    mounted.push(editor);
    editor.view.dispatch({ selection: { anchor: editor.view.state.doc.length } });
    const card = editor.view.contentDOM.querySelector(".cm-card-embed");
    expect(card?.textContent).toContain("Loading card");
    await new Promise((r) => setTimeout(r, 0));
    expect(card?.textContent).toContain("Später da.");
  });

  it("shows a missing card as such", async () => {
    const none: WikiLinkProvider = { ...provider, card: () => undefined };
    const editor = createNoteEditor({
      parent: document.body.appendChild(document.createElement("div")),
      value: "![[c_01JB8Z3Q]]\n\nText",
      provider: none,
    });
    mounted.push(editor);
    editor.view.dispatch({ selection: { anchor: editor.view.state.doc.length } });
    expect(editor.view.contentDOM.querySelector(".cm-card-missing")).not.toBeNull();
  });

  it("opens a rendered link on click and a raw link only on mod-click", () => {
    const opened: unknown[] = [];
    const editor = mount("Siehe [[luhmann1984soziale#^b7]] hier", (e) => opened.push(e));
    focus(editor);
    editor.view.dispatch({ selection: { anchor: editor.view.state.doc.length } });
    const link = editor.view.contentDOM.querySelector<HTMLElement>(".cm-wikilink");
    expect(link).not.toBeNull();
    link?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    expect(opened).toEqual([{ target: "luhmann1984soziale", embed: false, anchor: "^b7" }]);

    editor.view.dispatch({ selection: { anchor: 8 } });
    const raw = editor.view.contentDOM.querySelector<HTMLElement>(".cm-wikilink-raw");
    raw?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    expect(opened).toHaveLength(1);
    raw?.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true, metaKey: true }),
    );
    expect(opened).toHaveLength(2);
  });

  it("opens and closes the frontmatter block from its button", () => {
    const text = "---\nid: n_1\n---\n\nText";
    const editor = mount(text);
    editor.view.dispatch({ selection: { anchor: text.length } });
    const fold = editor.view.contentDOM.querySelector<HTMLElement>(".cm-frontmatter-toggle");
    expect(fold?.getAttribute("aria-expanded")).toBe("false");
    expect(editor.view.contentDOM.textContent).not.toContain("id: n_1");
    fold?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    expect(editor.view.contentDOM.textContent).toContain("id: n_1");
    const close = editor.view.contentDOM.querySelector<HTMLElement>(".cm-frontmatter-open");
    close?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    expect(editor.view.contentDOM.textContent).not.toContain("id: n_1");
    expect(editor.getValue()).toBe(text);
  });

  it("toggles a task checkbox in the document", () => {
    const editor = mount("- [ ] offen\n\nEnde");
    editor.view.dispatch({ selection: { anchor: editor.view.state.doc.length } });
    const box = editor.view.contentDOM.querySelector<HTMLInputElement>(".cm-task-checkbox");
    box?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    expect(editor.getValue()).toBe("- [x] offen\n\nEnde");
  });

  it("exports the live preview extension", () => {
    expect(livePreview).toBeDefined();
  });
});
