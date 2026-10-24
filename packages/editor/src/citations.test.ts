import "./test-dom";
import { CompletionContext } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { afterEach, describe, expect, it } from "vitest";
import { citationSource, filterCitations } from "./citations";
import { configFacet } from "./config";
import { createNoteEditor, type NoteEditor } from "./editor";
import { type CitationProvider, type CitationSuggestion, DEFAULT_LABELS } from "./types";

const ALL: CitationSuggestion[] = [
  { key: "luhmann1984soziale", title: "Soziale Systeme", detail: "Luhmann 1984", group: "library" },
  {
    key: "gillespie2018custodians",
    title: "Custodians of the Internet",
    detail: "Gillespie 2018",
    group: "project",
  },
  { key: "maturana1980autopoiesis", title: "Autopoiesis and Cognition", group: "project" },
];

const provider: CitationProvider = {
  suggest: (query) => filterCitations(ALL, query),
  resolve: (key) => {
    const hit = ALL.find((s) => s.key === key);
    return hit ? { title: hit.title } : undefined;
  },
};

async function complete(
  doc: string,
  pos = doc.length,
  citations: CitationProvider | null = provider,
) {
  const state = EditorState.create({
    doc,
    extensions: [
      configFacet.of({
        provider: undefined,
        citations: citations ?? undefined,
        labels: DEFAULT_LABELS,
        onOpenLink: undefined,
      }),
    ],
  });
  return citationSource(new CompletionContext(state, pos, true));
}

describe("filterCitations", () => {
  it("lists the sources of the project before the rest of the library", () => {
    expect(filterCitations(ALL, "").map((s) => s.key)).toEqual([
      "gillespie2018custodians",
      "maturana1980autopoiesis",
      "luhmann1984soziale",
    ]);
  });

  it("ranks the key prefix before the title and keeps the project first", () => {
    expect(filterCitations(ALL, "auto").map((s) => s.key)).toEqual(["maturana1980autopoiesis"]);
    expect(filterCitations(ALL, "LUHMANN 19").map((s) => s.key)).toEqual(["luhmann1984soziale"]);
    expect(filterCitations(ALL, "custod").map((s) => s.key)).toEqual(["gillespie2018custodians"]);
    expect(filterCitations(ALL, "nichts davon")).toEqual([]);
    expect(filterCitations(ALL, "", 1)).toHaveLength(1);
  });
});

describe("citation completion source", () => {
  it("offers the library after [@, project sources first", async () => {
    const r = await complete("Das gilt [@");
    expect(r?.from).toBe(11);
    expect(r?.options.map((o) => o.label)).toEqual([
      "gillespie2018custodians",
      "maturana1980autopoiesis",
      "luhmann1984soziale",
    ]);
    expect(r?.options.map((o) => (o.section as { name: string }).name)).toEqual([
      "This project",
      "This project",
      "Library",
    ]);
    expect(r?.options[0]?.detail).toBe("Custodians of the Internet");
  });

  it("narrows by the typed key and starts at the key, not at the @", async () => {
    const r = await complete("Siehe [@luh");
    expect(r?.from).toBe(8);
    expect(r?.options.map((o) => o.label)).toEqual(["luhmann1984soziale"]);
  });

  it("triggers in a cluster after a semicolon, for a suppressed author and for @key in running text", async () => {
    expect((await complete("[@a2020b; @gil"))?.from).toBe(11);
    expect((await complete("[-@gil"))?.from).toBe(3);
    expect((await complete("Nach @gil"))?.from).toBe(6);
    expect((await complete("@gil"))?.from).toBe(1);
  });

  it("stays quiet for e-mail addresses, escaped signs and ordinary text", async () => {
    expect(await complete("Mail an jonny@example")).toBeNull();
    expect(await complete("Escaped \\@gil")).toBeNull();
    expect(await complete("Kein Zeichen hier")).toBeNull();
    expect(await complete("Zeile mit @key\nnächste Zeile ohne")).toBeNull();
  });

  it("does nothing without a citation provider", async () => {
    expect(await complete("[@", 2, null)).toBeNull();
  });
});

const mounted: NoteEditor[] = [];
afterEach(() => {
  for (const e of mounted.splice(0)) e.destroy();
  document.body.replaceChildren();
});

function mount(doc: string, citations: CitationProvider | null = provider): NoteEditor {
  const editor = createNoteEditor({
    parent: document.body.appendChild(document.createElement("div")),
    value: doc,
    ...(citations ? { citations } : {}),
  });
  mounted.push(editor);
  return editor;
}

const marks = (editor: NoteEditor) =>
  [...editor.view.dom.querySelectorAll(".cm-cite")].map((el) => ({
    text: el.textContent,
    unknown: el.classList.contains("cm-cite-unknown"),
    title: el.getAttribute("title"),
  }));

describe("citation marks", () => {
  it("marks known keys and flags unknown ones with a title", () => {
    const editor = mount(
      "Siehe [@luhmann1984soziale, S. 12; @nobody2020none] und @gillespie2018custodians.",
    );
    expect(marks(editor)).toEqual([
      { text: "luhmann1984soziale", unknown: false, title: "Soziale Systeme" },
      { text: "nobody2020none", unknown: true, title: "Unknown citekey: nobody2020none" },
      { text: "gillespie2018custodians", unknown: false, title: "Custodians of the Internet" },
    ]);
  });

  it("marks nothing in code, links or without a provider", () => {
    const text = "`[@x2020y]` und [Link](https://x.org/@user)";
    expect(marks(mount(text))).toEqual([]);
    expect(marks(mount("[@luhmann1984soziale]", null))).toEqual([]);
  });

  it("updates while typing and when the provider changes", () => {
    const editor = mount("Anfang");
    editor.view.dispatch({ changes: { from: 6, insert: " [@maturana1980autopoiesis]" } });
    expect(marks(editor)).toHaveLength(1);
    editor.configure({ citations: { suggest: () => [], resolve: () => undefined } });
    expect(marks(editor)).toEqual([
      expect.objectContaining({ text: "maturana1980autopoiesis", unknown: true }),
    ]);
  });
});

describe("accepting a completion", () => {
  it("replaces the typed part with the citekey and leaves the brackets alone", async () => {
    const editor = mount("Siehe [@luh, S. 3]");
    editor.view.dispatch({ selection: { anchor: 11 } });
    const result = await citationSource(new CompletionContext(editor.view.state, 11, true));
    const option = result?.options[0];
    if (!result || !option || typeof option.apply !== "string") throw new Error("no option");
    editor.view.dispatch({ changes: { from: result.from, to: 11, insert: option.apply } });
    expect(editor.getValue()).toBe("Siehe [@luhmann1984soziale, S. 3]");
  });
});

describe("insert", () => {
  it("writes at the cursor once the person has been in the editor", () => {
    const editor = mount("Vorher Nachher");
    editor.view.dispatch({ selection: { anchor: 7 } });
    editor.insert("[@luhmann1984soziale] ");
    expect(editor.getValue()).toBe("Vorher [@luhmann1984soziale] Nachher");
    expect(editor.view.state.selection.main.head).toBe(7 + "[@luhmann1984soziale] ".length);
  });

  it("appends to an editor nobody has used, as a paragraph of its own", () => {
    const editor = mount("Erster Absatz.\n");
    editor.insert("Zitat [@a2020b].");
    expect(editor.getValue()).toBe("Erster Absatz.\n\nZitat [@a2020b].\n");
    const empty = mount("");
    empty.insert("Nur das.");
    expect(empty.getValue()).toBe("Nur das.");
  });

  it("reports the edit through onChange", () => {
    const seen: string[] = [];
    const editor = createNoteEditor({
      parent: document.body.appendChild(document.createElement("div")),
      value: "A",
      onChange: (v) => seen.push(v),
    });
    mounted.push(editor);
    editor.insert("B");
    expect(seen.at(-1)).toContain("B");
  });
});
