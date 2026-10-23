import "./test-dom";
import { afterEach, describe, expect, it } from "vitest";
import { createNoteEditor, type NoteEditor } from "./editor";
import type { WikiLinkProvider } from "./types";

const provider: WikiLinkProvider = {
  suggest: () => [],
  resolve: (t) =>
    t === "luhmann1984soziale" ? { kind: "item", label: "Soziale Systeme" } : undefined,
  card: (id) => ({
    id,
    quote: "Das System beobachtet sich selbst.",
    page: "31",
    citation: "Luhmann 1984",
  }),
};

const mounted: NoteEditor[] = [];
function mount(value: string, extra: { onChange?: (v: string) => void } = {}): NoteEditor {
  const editor = createNoteEditor({
    parent: document.body.appendChild(document.createElement("div")),
    value,
    provider,
    ...extra,
  });
  mounted.push(editor);
  return editor;
}
afterEach(() => {
  for (const e of mounted.splice(0)) e.destroy();
  document.body.replaceChildren();
});

const SAMPLES: Record<string, string> = {
  empty: "",
  plain: "Ein Satz.",
  trailingNewline: "Zeile eins\nZeile zwei\n",
  noTrailingNewline: "Zeile eins\nZeile zwei",
  manyBlankLines: "a\n\n\n\nb\n\n",
  frontmatter:
    '---\nid: n_01JB9\ntitle: Autopoiesis\nlinks:\n  - to: "[[luhmann1984soziale]]"\n---\n\n# Titel\n\nText.\n',
  emptyFrontmatter: "---\n---\nText",
  crlf: "# Titel\r\n\r\nEin **Absatz**\r\nmit [[luhmann1984soziale]].\r\n",
  mixedEndings: "a\r\nb\nc\r\nd",
  loneCarriageReturn: "a\rb\n",
  tabsAndTrailingSpaces: "\tEingerückt  \n- [ ] Aufgabe \n  - verschachtelt\t\n",
  unicode: "Überschrift – „Zitat“ 日本語 😀 é",
  emphasis: '*kursiv* **fett** ~~weg~~ `code` [Link](https://example.org "Titel")',
  markers: "> Zitat\n\n---\n\n1. eins\n2. zwei\n\n* a\n+ b\n\n- [x] fertig\n",
  codeFence: "```ts\nconst x = [[not a link]];\n```\n\n    indented code\n",
  wikiLinks: "Siehe [[luhmann1984soziale#^b7|Luhmann]] und ![[c_01JB8Z3Q]] und [[unbekannt]].",
  table: "| a | b |\n|---|---|\n| 1 | 2 |\n",
  html: "<div>roh</div>\n\n<!-- Kommentar -->\n",
  bom: "﻿Text mit BOM",
};

describe("lossless round trip", () => {
  for (const [name, text] of Object.entries(SAMPLES)) {
    it(`returns ${name} byte for byte`, () => {
      const editor = mount(text);
      expect(editor.getValue()).toBe(text);
    });

    it(`keeps ${name} unchanged while the cursor moves through it`, () => {
      const editor = mount(text);
      const len = editor.view.state.doc.length;
      for (let pos = 0; pos <= len; pos++) {
        editor.view.dispatch({ selection: { anchor: pos } });
        expect(editor.getValue()).toBe(text);
      }
      editor.view.dispatch({ selection: { anchor: 0, head: len } });
      expect(editor.getValue()).toBe(text);
    });
  }

  it("fires onChange only for real edits and the result differs by exactly that edit", () => {
    const text = "---\nid: n_1\n---\n\nAnfang **fett** Ende\n";
    const seen: string[] = [];
    const editor = mount(text, { onChange: (v) => seen.push(v) });
    editor.view.dispatch({ selection: { anchor: 5 } });
    editor.setValue(text);
    expect(seen).toEqual([]);
    const at = text.indexOf("Ende");
    editor.view.dispatch({ changes: { from: at, insert: "das " } });
    expect(seen).toEqual([`${text.slice(0, at)}das ${text.slice(at)}`]);
    expect(editor.getValue()).toBe(seen[0]);
  });

  it("keeps CRLF line endings when text is typed", () => {
    const editor = mount("eins\r\nzwei\r\n");
    editor.view.dispatch({ changes: { from: 4, insert: "!" } });
    expect(editor.getValue()).toBe("eins!\r\nzwei\r\n");
    editor.view.dispatch({ changes: { from: 5, insert: editor.view.state.lineBreak } });
    expect(editor.getValue()).toBe("eins!\r\n\r\nzwei\r\n");
  });

  it("setValue changes only the differing part and keeps the cursor", () => {
    const editor = mount("Anfang Mitte Ende");
    editor.view.dispatch({ selection: { anchor: 3 } });
    editor.setValue("Anfang neue Mitte Ende");
    expect(editor.getValue()).toBe("Anfang neue Mitte Ende");
    expect(editor.view.state.selection.main.head).toBe(3);
  });

  it("setValue to text with other line endings swaps the document", () => {
    const editor = mount("a\nb");
    editor.setValue("a\r\nb\r\n");
    expect(editor.getValue()).toBe("a\r\nb\r\n");
    editor.setValue("x");
    expect(editor.getValue()).toBe("x");
  });
});
