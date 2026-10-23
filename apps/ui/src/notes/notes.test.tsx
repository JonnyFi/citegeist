import { noteEditorAt } from "@citegeist/editor";
import { notesUpdate } from "@citegeist/ops";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { translator } from "../i18n";
import { createMockCore } from "../mock/core";
import { createFixtures } from "../mock/fixtures";
import { createReflowFixtures, renderApp } from "../test-utils";
import { buildLinkIndex, createProvider } from "./library-links";

const AUTOPOIESIS = "n_0000000000000001";
const ZETTEL = "n_0000000000000002";
const FRAGE = "n_0000000000000003";

async function openEditor(): Promise<ReturnType<typeof noteEditorAt> & object> {
  const content = await waitFor(() => {
    const el = document.querySelector<HTMLElement>(".cm-content");
    if (!el) throw new Error("editor not mounted yet");
    return el;
  });
  const editor = noteEditorAt(content);
  if (!editor) throw new Error("no editor");
  return editor;
}

const updates = (calls: Array<{ name: string; input: unknown }>) =>
  calls.filter((c) => c.name === notesUpdate.name).map((c) => c.input as Record<string, unknown>);

describe("notes list and navigation", () => {
  it("opens from the sidebar and lists the notes, newest change first", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await user.click(await screen.findByRole("link", { name: "Notizen" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Notizen" })).toBeVisible();
    const rows = await screen.findAllByTestId("note-row");
    expect(rows.map((r) => r.textContent)).toEqual([
      "Autopoiesis und Kommunikation",
      "Das Zettelkasten-Prinzip",
      "Wie wirken Plattformen auf Kommunikation?",
    ]);
    expect(screen.getByText("Wähle eine Notiz")).toBeVisible();
  });

  it("filters by title and says so when nothing matches", async () => {
    const user = userEvent.setup();
    renderApp("/notes");
    await screen.findAllByTestId("note-row");
    const filter = screen.getByRole("searchbox", { name: "Notizen filtern" });
    await user.type(filter, "zettel");
    await waitFor(() => expect(screen.getAllByTestId("note-row")).toHaveLength(1));
    await user.clear(filter);
    await user.type(filter, "gibtesnicht");
    expect(await screen.findByText("Keine Notiz passt zum Filter.")).toBeVisible();
  });

  it("keeps the list when a note is opened", async () => {
    const user = userEvent.setup();
    renderApp("/notes");
    const filter = await screen.findByRole("searchbox", { name: "Notizen filtern" });
    await user.type(filter, "plattformen");
    await user.click(await screen.findByRole("link", { name: /Plattformen/ }));
    expect(await screen.findByRole("textbox", { name: "Titel der Notiz" })).toHaveValue(
      "Wie wirken Plattformen auf Kommunikation?",
    );
    expect(screen.getByRole("searchbox", { name: "Notizen filtern" })).toHaveValue("plattformen");
  });

  it("creates a note, opens it and puts the cursor into the title", async () => {
    const user = userEvent.setup();
    const { calls } = renderApp("/notes");
    await user.click(await screen.findByRole("button", { name: "Neue Notiz" }));
    const title = await screen.findByRole("textbox", { name: "Titel der Notiz" });
    expect(title).toHaveValue("Unbenannte Notiz");
    await waitFor(() => expect(title).toHaveFocus());
    expect(calls.find((c) => c.name === "notes.create")?.input).toMatchObject({
      title: "Unbenannte Notiz",
      type: "permanent",
    });
    expect(await screen.findAllByTestId("note-row")).toHaveLength(4);
  });

  it("uses English strings when the language is English", async () => {
    renderApp("/notes", undefined, { lang: "en" });
    expect(await screen.findByRole("heading", { level: 1, name: "Notes" })).toBeVisible();
    expect(screen.getByRole("button", { name: "New note" })).toBeVisible();
    expect(await screen.findByText("Pick a note")).toBeVisible();
  });
});

describe("note view", () => {
  it("renders the live preview, a card embed and the backlinks", async () => {
    renderApp(`/notes/${AUTOPOIESIS}`);
    const editor = await openEditor();
    await waitFor(() =>
      expect(editor.view.contentDOM.querySelector(".cm-card-embed")).not.toBeNull(),
    );
    const text = editor.view.contentDOM.textContent ?? "";
    expect(text).toContain("Autopoiesis und Kommunikation");
    expect(text).not.toContain("# ");
    expect(text).not.toContain("[[");
    const card = editor.view.contentDOM.querySelector(".cm-card-embed");
    expect(card?.textContent).toContain("Soziale Systeme bestehen aus Kommunikationen");
    expect(card?.textContent).toContain("Luhmann 1984");
    expect(card?.textContent).toContain("S. 31");

    const backlinks = await screen.findByTestId("backlinks");
    expect(within(backlinks).getByRole("link", { name: "Das Zettelkasten-Prinzip" })).toBeVisible();
  });

  it("shows an empty backlinks state", async () => {
    renderApp(`/notes/${FRAGE}`);
    expect(await screen.findByText("Noch verweist nichts auf diese Notiz.")).toBeVisible();
  });

  it("opens an item from a rendered wiki link", async () => {
    renderApp(`/notes/${AUTOPOIESIS}`);
    const editor = await openEditor();
    const link = await waitFor(() => {
      const el = editor.view.contentDOM.querySelector<HTMLElement>(
        '.cm-wikilink-item[data-target="luhmann1984soziale"]',
      );
      if (!el) throw new Error("link not rendered yet");
      return el;
    });
    expect(link).toHaveClass("cm-wikilink-item");
    fireEvent.mouseDown(link);
    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: /Soziale Systeme: Grundriss einer allgemeinen Theorie/,
      }),
    ).toBeVisible();
  });

  it("opens another note from a wiki link by slug", async () => {
    renderApp(`/notes/${AUTOPOIESIS}`);
    const editor = await openEditor();
    const link = await waitFor(() => {
      const el = editor.view.contentDOM.querySelector<HTMLElement>(
        '.cm-wikilink-note[data-target="zettelkasten-prinzip"]',
      );
      if (!el) throw new Error("link not rendered yet");
      return el;
    });
    fireEvent.mouseDown(link);
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "Titel der Notiz" })).toHaveValue(
        "Das Zettelkasten-Prinzip",
      ),
    );
  });

  it("opens the card in the reader from its embed", async () => {
    renderApp(`/notes/${AUTOPOIESIS}`, createReflowFixtures());
    const editor = await openEditor();
    const open = await waitFor(() => {
      const el = editor.view.contentDOM.querySelector<HTMLElement>(".cm-card-open");
      if (!el) throw new Error("embed not rendered yet");
      return el;
    });
    fireEvent.mouseDown(open);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Lesen", pressed: true })).toBeVisible(),
    );
  });

  it("renders task checkboxes and note links", async () => {
    renderApp(`/notes/${ZETTEL}`);
    const editor = await openEditor();
    await waitFor(() =>
      expect(editor.view.contentDOM.querySelector(".cm-wikilink")).not.toBeNull(),
    );
    expect(editor.view.contentDOM.querySelector(".cm-task-checkbox")).not.toBeNull();
    expect(editor.view.contentDOM.querySelector(".cm-wikilink-note")).not.toBeNull();
  });
});

describe("autosave", () => {
  it("saves the body through notes.update after the last edit", async () => {
    const { calls } = renderApp(`/notes/${ZETTEL}`);
    const editor = await openEditor();
    const end = editor.view.state.doc.length;
    editor.view.dispatch({ changes: { from: end, insert: "\nNeuer Absatz." } });
    editor.view.dispatch({ changes: { from: end + 14, insert: " Mehr." } });
    await waitFor(() => expect(updates(calls)).toHaveLength(1), { timeout: 4000 });
    expect(updates(calls)[0]).toEqual({
      id: ZETTEL,
      body: expect.stringMatching(/Neuer Absatz\. Mehr\.$/),
    });
    await waitFor(() => expect(screen.getByTestId("save-state")).toHaveTextContent("Gespeichert"));
    // The edit survives a reload from the core.
    expect(editor.getValue()).toMatch(/Neuer Absatz\. Mehr\.$/);
  });

  it("saves a new title without touching the body", async () => {
    const user = userEvent.setup();
    const { calls } = renderApp(`/notes/${FRAGE}`);
    const title = await screen.findByRole("textbox", { name: "Titel der Notiz" });
    await user.clear(title);
    await user.type(title, "Neue Frage");
    await waitFor(() => expect(updates(calls).length).toBeGreaterThan(0), { timeout: 4000 });
    expect(updates(calls).at(-1)).toEqual({ id: FRAGE, title: "Neue Frage" });
    expect((await screen.findAllByText("Neue Frage")).length).toBeGreaterThan(0);
  });

  it("never saves an empty title", async () => {
    const user = userEvent.setup();
    const { calls } = renderApp(`/notes/${FRAGE}`);
    const title = await screen.findByRole("textbox", { name: "Titel der Notiz" });
    await user.clear(title);
    await new Promise((r) => setTimeout(r, 1200));
    expect(updates(calls)).toHaveLength(0);
  });

  it("writes pending edits when the note is left before the timer fires", async () => {
    const user = userEvent.setup();
    const { calls } = renderApp(`/notes/${ZETTEL}`);
    const editor = await openEditor();
    editor.view.dispatch({ changes: { from: 0, insert: "Vorne: " } });
    await user.click(await screen.findByRole("link", { name: /Plattformen/ }));
    await waitFor(() => expect(updates(calls)).toHaveLength(1));
    expect(updates(calls)[0]).toMatchObject({
      id: ZETTEL,
      body: expect.stringMatching(/^Vorne: /),
    });
  });

  it("does not save when nothing changed", async () => {
    const { calls } = renderApp(`/notes/${ZETTEL}`);
    await openEditor();
    await new Promise((r) => setTimeout(r, 1200));
    expect(updates(calls)).toHaveLength(0);
  });

  it("reports a failed save, keeps the text and saves again on retry", async () => {
    const user = userEvent.setup();
    const { core, calls } = renderApp(`/notes/${ZETTEL}`);
    const editor = await openEditor();
    const original = core.call.bind(core);
    let fail = true;
    core.call = ((contract, input) => {
      if (contract.name === notesUpdate.name && fail) return Promise.reject(new Error("offline"));
      return original(contract, input);
    }) as typeof core.call;
    editor.view.dispatch({ changes: { from: 0, insert: "Wichtig: " } });
    await waitFor(
      () => expect(screen.getByTestId("save-state")).toHaveAttribute("data-state", "failed"),
      {
        timeout: 4000,
      },
    );
    expect(editor.getValue()).toMatch(/^Wichtig: /);
    fail = false;
    await user.click(screen.getByRole("button", { name: "Erneut speichern" }));
    await waitFor(() =>
      expect(screen.getByTestId("save-state")).toHaveAttribute("data-state", "saved"),
    );
    expect(updates(calls).at(-1)).toMatchObject({ id: ZETTEL });
  });

  it("adopts a change made elsewhere when there are no pending edits", async () => {
    const { core } = renderApp(`/notes/${ZETTEL}`);
    const editor = await openEditor();
    await core.call(notesUpdate, { id: ZETTEL, body: "Extern geändert." });
    await waitFor(() => expect(editor.getValue()).toBe("Extern geändert."));
  });
});

describe("library links", () => {
  async function provider() {
    const core = createMockCore(createFixtures());
    const index = await buildLinkIndex(core);
    return createProvider(index, translator("de"));
  }

  it("suggests citekeys, note slugs and card ids for [[", async () => {
    const p = await provider();
    const all = await p.suggest("", { embed: false });
    const kinds = new Set(all.map((s) => s.kind));
    expect(kinds).toEqual(new Set(["item", "note", "card"]));
    const luhmann = await p.suggest("luhmann", { embed: false });
    expect(luhmann[0]).toMatchObject({
      kind: "item",
      target: "luhmann1984soziale",
      detail: "Luhmann 1984",
    });
    const notes = await p.suggest("zettel", { embed: false });
    expect(notes[0]).toMatchObject({ kind: "note", target: "zettelkasten-prinzip" });
  });

  it("suggests only cards for ![[ and finds them by their quote", async () => {
    const p = await provider();
    const cards = await p.suggest("kommunikation", { embed: true });
    expect(cards.length).toBeGreaterThan(0);
    expect(cards.every((s) => s.kind === "card")).toBe(true);
    expect(cards[0]?.target).toMatch(/^c_/);
    expect(cards[0]?.detail).toContain("Luhmann 1984");
  });

  it("resolves targets and delivers card data", async () => {
    const p = await provider();
    expect(p.resolve("luhmann1984soziale")?.kind).toBe("item");
    expect(p.resolve("zettelkasten-prinzip")?.kind).toBe("note");
    expect(p.resolve(AUTOPOIESIS)?.kind).toBe("note");
    expect(p.resolve("gibtesnicht")).toBeUndefined();
    const [first] = await p.suggest("", { embed: true });
    const card = await p.card?.(first?.target ?? "");
    expect(card).toMatchObject({ citation: expect.stringContaining("Luhmann") });
    expect(card?.quote.length).toBeGreaterThan(10);
  });
});
