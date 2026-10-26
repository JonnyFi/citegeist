import "./test-dom";
import { completionStatus, startCompletion } from "@codemirror/autocomplete";
import { afterEach, describe, expect, it } from "vitest";
import { citationCompletions, filterCitations } from "./citations";
import { createNoteEditor, type NoteEditor } from "./editor";
import type { CitationInsertKind, CitationProvider, CitationSuggestion } from "./types";

const ALL: CitationSuggestion[] = [
  { key: "luhmann1984soziale", title: "Soziale Systeme", detail: "Luhmann 1984", group: "library" },
  { key: "gillespie2018custodians", title: "Custodians of the Internet", group: "project" },
  {
    key: "luhmann1984soziale",
    title: "Das System beobachtet sich selbst.",
    detail: "Luhmann 1984, S. 31",
    kind: "card",
    id: "c_01JB8Z3Q",
  },
];

const calls: Array<{ id: string; kind: CitationInsertKind }> = [];
let release: ((text: string) => void) | undefined;

function makeProvider(insert: CitationProvider["insertCard"]): CitationProvider {
  return {
    suggest: (q) => filterCitations(ALL, q),
    resolve: (key) => {
      const hit = ALL.find((s) => s.key === key && s.kind !== "card");
      return hit ? { title: hit.title } : undefined;
    },
    ...(insert ? { insertCard: insert } : {}),
  };
}

const immediate = makeProvider(async (id, kind) => {
  calls.push({ id, kind });
  return `${kind}:${id}`;
});

const mounted: NoteEditor[] = [];
afterEach(() => {
  for (const e of mounted.splice(0)) e.destroy();
  document.body.replaceChildren();
  calls.length = 0;
  release = undefined;
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until(check: () => boolean) {
  for (let i = 0; i < 100 && !check(); i++) await sleep(5);
  expect(check()).toBe(true);
}

/** Mounts `doc` with the cursor at `at` (default the end) and opens the `@` menu. */
async function menu(doc: string, provider: CitationProvider = immediate, at = doc.length) {
  const editor = createNoteEditor({
    parent: document.body.appendChild(document.createElement("div")),
    value: doc,
    citations: provider,
  });
  mounted.push(editor);
  editor.view.dispatch({ selection: { anchor: at } });
  startCompletion(editor.view);
  await until(() => completionStatus(editor.view.state) === "active");
  await sleep(90); // CodeMirror ignores accepts right after the menu opens
  return editor;
}

function select(editor: NoteEditor, label: string) {
  const items = [...editor.view.dom.querySelectorAll(".cm-tooltip-autocomplete li")];
  const index = items.findIndex((li) => li.textContent?.includes(label));
  expect(index).toBeGreaterThanOrEqual(0);
  for (let i = 0; i < index; i++) press(editor, "ArrowDown");
}

function press(editor: NoteEditor, key: string, mods: KeyboardEventInit = {}) {
  const code = { Enter: 13, ArrowDown: 40 }[key] ?? 0;
  editor.view.contentDOM.dispatchEvent(
    new KeyboardEvent("keydown", { key, keyCode: code, bubbles: true, cancelable: true, ...mods }),
  );
}

describe("filterCitations with cards", () => {
  it("finds a card by its quote, by its source and by the detail line", () => {
    expect(filterCitations(ALL, "beobachtet").map((s) => s.id)).toEqual(["c_01JB8Z3Q"]);
    expect(filterCitations(ALL, "S. 31").map((s) => s.id)).toEqual(["c_01JB8Z3Q"]);
    expect(filterCitations(ALL, "luhmann").map((s) => s.kind ?? "source")).toEqual([
      "source",
      "card",
    ]);
  });

  it("lists cards after all sources and never lets them push sources out", () => {
    const many: CitationSuggestion[] = [
      ...Array.from({ length: 5 }, (_, i) => ({
        key: `card${i}`,
        title: `Zitat ${i} mit gil`,
        kind: "card" as const,
        id: `c_${i}`,
      })),
      { key: "gillespie2018custodians", title: "Custodians", group: "library" },
    ];
    const out = filterCitations(many, "gil", 3);
    expect(out[0]?.key).toBe("gillespie2018custodians");
    expect(filterCitations(many, "").at(-1)?.kind).toBe("card");
  });
});

describe("the @ menu", () => {
  it("lists sources first and cards in their own section with the quote as the label", async () => {
    const editor = await menu("Das gilt [@");
    const items = [...editor.view.dom.querySelectorAll(".cm-tooltip-autocomplete li")];
    expect(items.map((li) => li.querySelector(".cm-completionLabel")?.textContent)).toEqual([
      "gillespie2018custodians",
      "luhmann1984soziale",
      "Das System beobachtet sich selbst.",
    ]);
    expect(
      [...editor.view.dom.querySelectorAll("completion-section")].map((x) => x.textContent),
    ).toEqual(["This project", "Library", "Cards"]);
    expect(editor.view.dom.querySelectorAll(".cm-cite-keys-hint")).toHaveLength(1);
    expect(editor.view.dom.querySelector(".cm-cite-keys-hint")?.textContent).toContain(
      "Shift+Enter",
    );
  });

  it("completes a source after [@ to the closed cluster [@key]", async () => {
    const editor = await menu("Das gilt [@gil");
    press(editor, "Enter");
    expect(editor.getValue()).toBe("Das gilt [@gillespie2018custodians]");
    expect(editor.view.state.selection.main.head).toBe(editor.getValue().length);
  });

  it("takes the closing bracket that is there and treats Shift and Alt like Enter for sources", async () => {
    for (const mods of [{}, { shiftKey: true }, { altKey: true }]) {
      const editor = await menu("A [@gil] B", immediate, 7);
      press(editor, "Enter", mods);
      expect(editor.getValue()).toBe("A [@gillespie2018custodians] B");
      expect(editor.view.state.selection.main.head).toBe(28);
      editor.destroy();
      mounted.pop();
    }
  });

  it("keeps the rest of the cluster when the bracket closes later", async () => {
    const editor = await menu("A [@gil, S. 3] B", immediate, 7);
    press(editor, "Enter");
    expect(editor.getValue()).toBe("A [@gillespie2018custodians, S. 3] B");
  });

  it("keeps a suppressed author inside brackets", async () => {
    const editor = await menu("A [-@gil");
    press(editor, "Enter");
    expect(editor.getValue()).toBe("A [-@gillespie2018custodians]");
  });

  it("writes only the key after a bare @", async () => {
    const editor = await menu("Nach @gil");
    press(editor, "Enter");
    expect(editor.getValue()).toBe("Nach @gillespie2018custodians");
    const dashed = await menu("Nach -@gil");
    press(dashed, "Enter");
    expect(dashed.getValue()).toBe("Nach -@gillespie2018custodians");
  });

  it("completes a source in the middle of a cluster to the key only", async () => {
    const editor = await menu("[@a2020b; @gil]", immediate, 14);
    press(editor, "Enter");
    expect(editor.getValue()).toBe("[@a2020b; @gillespie2018custodians]");
  });
});

describe("choosing a card", () => {
  const cases: Array<[string, KeyboardEventInit, CitationInsertKind]> = [
    ["Enter", {}, "direct"],
    ["Enter", { shiftKey: true }, "indirect"],
    ["Enter", { altKey: true }, "cite"],
  ];

  for (const [key, mods, kind] of cases) {
    it(`inserts the ${kind} text for ${JSON.stringify(mods)} and replaces [@q with its brackets`, async () => {
      const editor = await menu("Vorher [@beob] nachher", immediate, 13);
      select(editor, "beobachtet");
      press(editor, key, mods);
      await until(() => editor.getValue() !== "Vorher [@beob] nachher");
      expect(calls).toEqual([{ id: "c_01JB8Z3Q", kind }]);
      expect(editor.getValue()).toBe(`Vorher ${kind}:c_01JB8Z3Q nachher`);
      expect(editor.view.state.selection.main.head).toBe(`Vorher ${kind}:c_01JB8Z3Q`.length);
      expect(completionStatus(editor.view.state)).toBeNull();
    });
  }

  it("replaces a bare @query without brackets", async () => {
    const editor = await menu("Nach @beob");
    select(editor, "beobachtet");
    press(editor, "Enter");
    await until(() => editor.getValue() !== "Nach @beob");
    expect(editor.getValue()).toBe("Nach direct:c_01JB8Z3Q");
  });

  it("inserts the direct text on a mouse click", async () => {
    const editor = await menu("Siehe [@beob");
    const items = [...editor.view.dom.querySelectorAll(".cm-tooltip-autocomplete li")];
    const li = items.find((x) => x.textContent?.includes("beobachtet"));
    if (!li) throw new Error("no card option");
    li.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    await until(() => editor.getValue() !== "Siehe [@beob");
    expect(editor.getValue()).toBe("Siehe direct:c_01JB8Z3Q");
  });

  it("does nothing when the text changed while the promise was pending", async () => {
    const slow = makeProvider(
      () =>
        new Promise<string>((resolve) => {
          release = resolve;
        }),
    );
    const editor = await menu("Siehe [@beob", slow);
    select(editor, "beobachtet");
    press(editor, "Enter");
    editor.view.dispatch({ changes: { from: 0, insert: "Vorspann. " } });
    release?.("TEXT");
    await sleep(20);
    expect(editor.getValue()).toBe("Vorspann. Siehe [@beob");
  });

  it("inserts when only text elsewhere changed after the trigger", async () => {
    const slow = makeProvider(
      () =>
        new Promise<string>((resolve) => {
          release = resolve;
        }),
    );
    const editor = await menu("Siehe [@beob", slow);
    select(editor, "beobachtet");
    press(editor, "Enter");
    release?.("TEXT");
    await until(() => editor.getValue() === "Siehe TEXT");
  });

  it("leaves the text alone when insertCard rejects, throws or is missing", async () => {
    for (const insert of [
      async () => {
        throw new Error("boom");
      },
      () => {
        throw new Error("sync boom");
      },
      undefined,
    ] as const) {
      const editor = await menu("Siehe [@beob", makeProvider(insert as never));
      select(editor, "beobachtet");
      press(editor, "Enter");
      await sleep(20);
      expect(editor.getValue()).toBe("Siehe [@beob");
    }
  });

  it("accepts wiki-link completions with Enter as before", async () => {
    const editor = createNoteEditor({
      parent: document.body.appendChild(document.createElement("div")),
      value: "[[",
      provider: {
        suggest: () => [{ target: "x", label: "X", kind: "note" }],
        resolve: () => undefined,
      },
      citations: immediate,
    });
    mounted.push(editor);
    editor.view.dispatch({ selection: { anchor: 2 } });
    startCompletion(editor.view);
    await until(() => completionStatus(editor.view.state) === "active");
    await sleep(90);
    press(editor, "Enter");
    expect(editor.getValue()).toBe("[[x]]");
  });
});

describe("citationCompletions", () => {
  it("offers cards with the quote as label and the detail line", async () => {
    const editor = createNoteEditor({
      parent: document.body.appendChild(document.createElement("div")),
      value: "[@",
      citations: immediate,
    });
    mounted.push(editor);
    const r = await citationCompletions(editor.view.state);
    const card = r?.options.at(-1);
    expect(card?.label).toBe("Das System beobachtet sich selbst.");
    expect(card?.detail).toBe("Luhmann 1984, S. 31");
    expect(card?.section).toEqual({ name: "Cards", rank: 2 });
  });
});
