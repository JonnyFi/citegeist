import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWebFixtures, createReflowFixtures as reflowOnly, renderApp } from "../test-utils";

const READER = "/items/luhmann1984soziale?tab=read";
const PASSAGE =
  "beobachtet immer schon eine Operation, die sich an frueheren Operationen orientiert";

/** Selects text inside one block of the reflow document, as the user would with the mouse. */
async function select(blockId: string, text: string) {
  const node = document.getElementById(blockId)?.firstChild;
  if (!node) throw new Error(`block ${blockId} is not rendered`);
  const start = (node.textContent ?? "").indexOf(text);
  expect(start).toBeGreaterThanOrEqual(0);
  window.getSelection()?.setBaseAndExtent(node, start, node, start + text.length);
  await act(async () => {
    document.dispatchEvent(new Event("selectionchange"));
    await new Promise((r) => setTimeout(r, 200));
  });
}

async function openReader(data = reflowOnly(), options = {}) {
  const view = renderApp(READER, data, options);
  await screen.findByTestId("reflow-scroll");
  await screen.findAllByTestId("panel-card");
  return view;
}

describe("selection popover", () => {
  it("creates a card with the anchor of the selection and shows it at once in a pending state", async () => {
    const user = userEvent.setup();
    const { calls } = await openReader(reflowOnly(), { aiDelayMs: 600 });
    expect(screen.getAllByTestId("panel-card")).toHaveLength(3);
    await select("bpara0002", PASSAGE);
    await user.click(await screen.findByRole("button", { name: "Zitat (KI)" }));

    const create = calls.find((c) => c.name === "cards.create");
    expect(create?.input).toMatchObject({
      citekey: "luhmann1984soziale",
      quote: PASSAGE,
      anchor: { text: { exact: PASSAGE, block: "bpara0002" } },
    });

    // the card is there before the AI is done
    await waitFor(() => expect(screen.getAllByTestId("panel-card")).toHaveLength(4));
    const editor = await screen.findByTestId("card-editor");
    expect(within(editor).getByText(PASSAGE)).toBeVisible();
    expect(within(editor).getByText("Die KI schreibt die Paraphrase.")).toBeVisible();
    expect(within(editor).queryByText(/Sinngemäß:/)).not.toBeInTheDocument();

    // the paraphrase arrives, with its model stamp as a tooltip and not as a line of text
    expect(await within(editor).findByText(/Sinngemäß:/)).toBeVisible();
    expect(within(editor).getByTitle(/claude-code\/haiku, .*2026, de/)).toBeInTheDocument();
    expect(within(editor).queryByText(/claude-code\/haiku/)).toBeNull();
    expect(within(editor).queryByText("Die KI schreibt die Paraphrase.")).toBeNull();
    // the same call classified the card, and the reader sees the kind
    expect(within(editor).getByRole("combobox", { name: "Art" })).toHaveTextContent("These");
    expect(calls.some((c) => c.name === "jobs.get")).toBe(true);
  });

  it("takes the printed page from the converted document", async () => {
    const user = userEvent.setup();
    await openReader();
    await select("bpara0003", "Es gibt selbstreferentielle Systeme.");
    await user.click(await screen.findByRole("button", { name: "Zitat (KI)" }));
    const editor = await screen.findByTestId("card-editor");
    expect(within(editor).getByText("S. 58")).toBeVisible();
    // the page is not confirmed yet, which the card says
    expect(within(editor).getByText("Seite ungeprüft")).toBeVisible();
  });
});

describe("card panel", () => {
  async function openCard(snippet: RegExp) {
    const user = userEvent.setup();
    const view = await openReader();
    const row = screen.getAllByTestId("panel-card").find((r) => snippet.test(r.textContent ?? ""));
    if (!row) throw new Error("card row not found");
    await user.click(within(row).getByRole("button", { expanded: false }));
    return { user, view, editor: await screen.findByTestId("card-editor") };
  }

  it("shows quote, page and the paraphrase, with the model stamp as a tooltip", async () => {
    const { editor } = await openCard(/Soziale Systeme bestehen/);
    expect(within(editor).getByText(/Soziale Systeme bestehen aus Kommunikationen/)).toBeVisible();
    expect(within(editor).getByText("S. 31")).toBeVisible();
    expect(within(editor).getByText(/Social systems consist of communications only/)).toBeVisible();
    expect(within(editor).getByTitle(/claude-code, .*2026, en/)).toBeInTheDocument();
    expect(within(editor).queryByText(/claude-code/)).toBeNull();
    expect(within(editor).queryByText("Kernaussage")).toBeNull();
  });

  it("shows no core statement of an old card anywhere", async () => {
    const data = reflowOnly();
    const old = data.cards.find((c) => c.body.quote.startsWith("Soziale Systeme bestehen"));
    if (!old) throw new Error("fixture card missing");
    old.body = { ...old.body, core: "Alte Kernaussage zeppelin." };
    const user = userEvent.setup();
    await openReader(data);
    const row = screen
      .getAllByTestId("panel-card")
      .find((r) => /Soziale Systeme bestehen/.test(r.textContent ?? ""));
    if (!row) throw new Error("card row not found");
    expect(screen.queryByText(/zeppelin/)).toBeNull();
    await user.click(within(row).getByRole("button", { expanded: false }));
    await screen.findByTestId("card-editor");
    expect(screen.queryByText(/zeppelin/)).toBeNull();
  });

  it("has one note field and neither In meinen Worten nor Kommentar", async () => {
    const { editor } = await openCard(/Es gibt selbstreferentielle Systeme/);
    const note = within(editor).getByRole("textbox", { name: "Notiz" });
    expect(note).toHaveValue("Compare with Maturana's autopoiesis before using this in chapter 2.");
    expect(within(editor).queryByRole("textbox", { name: "In meinen Worten" })).toBeNull();
    expect(within(editor).queryByRole("textbox", { name: "Kommentar" })).toBeNull();
  });

  it("saves the note when the field loses focus", async () => {
    const { user, editor, view } = await openCard(/Es gibt selbstreferentielle Systeme/);
    const note = within(editor).getByRole("textbox", { name: "Notiz" });
    await user.clear(note);
    await user.type(note, "Selbstreferenz als Operation");
    await user.tab();
    await waitFor(() =>
      expect(view.calls.find((c) => c.name === "cards.update")?.input).toMatchObject({
        patch: { note: "Selbstreferenz als Operation" },
      }),
    );
    // the saved text is what the core now holds
    const stored = view.data.cards.find((c) =>
      c.body.quote.startsWith("Es gibt selbstreferentielle"),
    );
    expect(stored?.body.note).toBe("Selbstreferenz als Operation");
  });

  it("does not write anything when the text did not change", async () => {
    const { user, editor, view } = await openCard(/Es gibt selbstreferentielle Systeme/);
    await user.click(within(editor).getByRole("textbox", { name: "Notiz" }));
    await user.tab();
    expect(view.calls.some((c) => c.name === "cards.update")).toBe(false);
  });

  it("offers the six kinds and no Zitat or Kommentar", async () => {
    const { user, editor } = await openCard(/Soziale Systeme bestehen/);
    await user.click(within(editor).getByRole("combobox", { name: "Art" }));
    const list = await screen.findByRole("listbox");
    expect(
      within(list)
        .getAllByRole("option")
        .map((o) => o.textContent),
    ).toEqual(["Ohne Art", "These", "Befund", "Methode", "Definition", "Beispiel", "Kritik"]);
  });

  it("shows a card without kind as Ohne Art and lets the reader clear a kind", async () => {
    const { user, editor, view } = await openCard(/Doppelte Kontingenz/);
    const kind = within(editor).getByRole("combobox", { name: "Art" });
    expect(kind).toHaveTextContent("Ohne Art");
    await user.click(kind);
    await user.click(await screen.findByRole("option", { name: "Kritik" }));
    await waitFor(() =>
      expect(view.calls.find((c) => c.name === "cards.update")?.input).toMatchObject({
        patch: { kind: "critique" },
      }),
    );
    await user.click(within(editor).getByRole("combobox", { name: "Art" }));
    await user.click(await screen.findByRole("option", { name: "Ohne Art" }));
    await waitFor(() =>
      expect(view.calls.filter((c) => c.name === "cards.update")[1]?.input).toMatchObject({
        patch: { kind: null },
      }),
    );
    const stored = view.data.cards.find((c) => c.body.quote.startsWith("Doppelte Kontingenz"));
    expect(stored?.frontmatter.kind).toBeUndefined();
  });

  it("changes kind and tags", async () => {
    const { user, editor, view } = await openCard(/Soziale Systeme bestehen/);
    await user.click(within(editor).getByRole("combobox", { name: "Art" }));
    await user.click(await screen.findByRole("option", { name: "Befund" }));
    await waitFor(() =>
      expect(view.calls.find((c) => c.name === "cards.update")?.input).toMatchObject({
        patch: { kind: "finding" },
      }),
    );
    const tags = within(editor).getByRole("textbox", { name: "Tags" });
    await user.type(tags, "systemtheorie, kommunikation{Enter}");
    await waitFor(() =>
      expect(view.calls.filter((c) => c.name === "cards.update")[1]?.input).toMatchObject({
        patch: { tags: ["systemtheorie", "kommunikation"] },
      }),
    );
  });

  it("regenerates in the chosen language", async () => {
    const { user, editor, view } = await openCard(/Soziale Systeme bestehen/);
    await user.click(within(editor).getByRole("combobox", { name: "Sprache beim Neuschreiben" }));
    // the reader toolbar has a native language select with the same option names
    const list = await screen.findByRole("listbox");
    await user.click(within(list).getByRole("option", { name: "English" }));
    const block = within(editor).getByText("Paraphrase").closest("div")?.parentElement;
    if (!block) throw new Error("paraphrase block missing");
    // the rewrite action and the language belong to the paraphrase, not to the action bar
    expect(
      within(block).getByRole("combobox", { name: "Sprache beim Neuschreiben" }),
    ).toBeVisible();
    await user.click(within(block).getByRole("button", { name: "Neu schreiben" }));
    await waitFor(() =>
      expect(view.calls.find((c) => c.name === "cards.regenerate")?.input).toMatchObject({
        language: "en",
      }),
    );
    expect(await within(editor).findByText(/In other words \(en\)/)).toBeVisible();
  });
});

describe("copy as citation", () => {
  const written: Array<Record<string, Blob>> = [];

  class FakeClipboardItem {
    constructor(readonly data: Record<string, Blob>) {}
  }
  const fakeClipboard = () =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        write: async (items: FakeClipboardItem[]) => {
          for (const i of items) written.push(i.data);
        },
        writeText: async () => {},
      },
    });

  beforeEach(() => {
    written.length = 0;
    vi.stubGlobal("ClipboardItem", FakeClipboardItem);
  });
  afterEach(() => vi.unstubAllGlobals());

  async function open(snippet: RegExp = /Soziale Systeme bestehen/) {
    const user = userEvent.setup();
    fakeClipboard(); // after setup(), which installs its own clipboard
    const view = await openReader();
    const row = screen.getAllByTestId("panel-card").find((r) => snippet.test(r.textContent ?? ""));
    if (!row) throw new Error("card row not found");
    await user.click(within(row).getByRole("button", { expanded: false }));
    return { user, view, editor: await screen.findByTestId("card-editor") };
  }

  it("puts a direct citation on the clipboard as HTML and plain text", async () => {
    const { user, editor, view } = await open();
    await user.click(within(editor).getByRole("button", { name: "Wörtlich zitieren" }));
    expect(await within(editor).findByText("Wörtliches Zitat kopiert.")).toBeVisible();

    expect(view.calls.find((c) => c.name === "cards.export")?.input).toMatchObject({
      mode: "direct",
      format: "html",
      project: "phd-proposal",
    });
    expect(written).toHaveLength(1);
    const item = written[0] as Record<string, Blob>;
    expect(Object.keys(item).sort()).toEqual(["text/html", "text/plain"]);
    expect(await item["text/plain"]?.text()).toBe(
      "„Soziale Systeme bestehen aus Kommunikationen und nur aus Kommunikationen. Menschen sind in ihrer Umwelt“ (Luhmann 1984, S. 31).",
    );
    expect(await item["text/html"]?.text()).toContain("<blockquote>");
  });

  it("copies an indirect citation built from the paraphrase", async () => {
    const { user, editor, view } = await open();
    await user.click(within(editor).getByRole("button", { name: "Sinngemäß zitieren" }));
    expect(await within(editor).findByText("Sinngemäßes Zitat kopiert.")).toBeVisible();
    expect(view.calls.find((c) => c.name === "cards.export")?.input).toMatchObject({
      mode: "indirect",
    });
    const item = written[0] as Record<string, Blob>;
    expect(await item["text/plain"]?.text()).toMatch(/\(vgl\. Luhmann 1984, S\. 31\)\.$/);
  });

  it("builds the indirect citation from the note when the card has one", async () => {
    const { user, editor } = await open(/Es gibt selbstreferentielle Systeme/);
    await user.click(within(editor).getByRole("button", { name: "Sinngemäß zitieren" }));
    await within(editor).findByText("Sinngemäßes Zitat kopiert.");
    const item = written[0] as Record<string, Blob>;
    expect(await item["text/plain"]?.text()).toMatch(
      /^Compare with Maturana's autopoiesis before using this in chapter 2 \(vgl\. Luhmann 1984, S\. 58\)\.$/,
    );
  });

  it("has exactly the two quote actions in the bar and no rewrite action there", async () => {
    const { editor } = await open();
    expect(within(editor).getByRole("button", { name: "Wörtlich zitieren" })).toBeVisible();
    expect(within(editor).getByRole("button", { name: "Sinngemäß zitieren" })).toBeVisible();
    expect(
      within(editor).queryByRole("button", { name: "Als direktes Zitat kopieren" }),
    ).toBeNull();
    expect(within(editor).getAllByRole("button", { name: "Neu schreiben" })).toHaveLength(1);
  });
});

describe("AI language dropdown", () => {
  const dropdown = () => screen.findByTestId("reader-language") as Promise<HTMLSelectElement>;

  it("shows the library default when neither item nor project set a language", async () => {
    await openReader();
    const select = await dropdown();
    expect(select.value).toBe("de");
    expect(screen.getByText("Sprache der KI-Texte (Bibliothek)")).toBeVisible();
  });

  it("shows the project language when the project sets one", async () => {
    const data = reflowOnly();
    const project = data.projects.get("phd-proposal");
    if (project) project.frontmatter = { ...project.frontmatter, ai_language: "fr" };
    await openReader(data);
    expect((await dropdown()).value).toBe("fr");
    expect(screen.getByText("Sprache der KI-Texte (Projekt)")).toBeVisible();
  });

  it("prefers the item's own language and writes ai_language when changed", async () => {
    const user = userEvent.setup();
    const data = reflowOnly();
    const project = data.projects.get("phd-proposal");
    if (project) project.frontmatter = { ...project.frontmatter, ai_language: "fr" };
    const view = await openReader(data);
    await user.selectOptions(await dropdown(), "en");
    await waitFor(() =>
      expect(view.calls.find((c) => c.name === "items.update")?.input).toEqual({
        citekey: "luhmann1984soziale",
        patch: { ai_language: "en" },
      }),
    );
    expect(data.items.get("luhmann1984soziale")?.frontmatter.ai_language).toBe("en");
    await waitFor(async () => expect((await dropdown()).value).toBe("en"));
    expect(screen.getByText("Sprache der KI-Texte (Quelle)")).toBeVisible();
  });

  it("makes new cards use the chosen language", async () => {
    const user = userEvent.setup();
    await openReader();
    await user.selectOptions(await dropdown(), "en");
    await waitFor(async () => expect((await dropdown()).value).toBe("en"));
    await select("bpara0002", PASSAGE);
    await user.click(await screen.findByRole("button", { name: "Zitat (KI)" }));
    expect(await screen.findByText(/In other words \(en\)/)).toBeVisible();
  });
});

describe("page confirmation banner", () => {
  it("is shown once and confirms the labels as they are", async () => {
    const user = userEvent.setup();
    const view = await openReader();
    const banner = await screen.findByRole("region", { name: "Seitenzahlen prüfen" });
    await user.click(within(banner).getByRole("button", { name: "Bestätigen" }));
    await waitFor(() =>
      expect(view.calls.find((c) => c.name === "documents.confirmPages")?.input).toEqual({
        citekey: "luhmann1984soziale",
        source: view.data.docs.get("luhmann1984soziale")?.source,
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "Seitenzahlen prüfen" })).not.toBeInTheDocument(),
    );
  });

  it("sends an offset when the reader corrects the printed number", async () => {
    const user = userEvent.setup();
    const view = await openReader();
    const banner = await screen.findByRole("region", { name: "Seitenzahlen prüfen" });
    const printed = within(banner).getByRole("textbox");
    await user.clear(printed);
    await user.type(printed, "40");
    await user.click(within(banner).getByRole("button", { name: "Korrigieren" }));
    await waitFor(() =>
      expect(view.calls.find((c) => c.name === "documents.confirmPages")?.input).toMatchObject({
        offset: 39,
      }),
    );
    const doc = view.data.docs.get("luhmann1984soziale");
    expect(doc?.pages.pages.map((p) => p.label)).toEqual(["40", "41", "42"]);
  });
});

describe("a source without pages", () => {
  it("does not ask for page numbers", async () => {
    await openReader(createWebFixtures());
    expect(screen.queryByRole("region", { name: "Seitenzahlen prüfen" })).not.toBeInTheDocument();
  });

  it("gives a new card the paragraph instead of a page", async () => {
    const user = userEvent.setup();
    const view = await openReader(createWebFixtures());
    await select("bpara0002", PASSAGE);
    await user.click(await screen.findByRole("button", { name: "Zitat (KI)" }));
    const editor = await screen.findByTestId("card-editor");
    // bpara0002 is the second text block of the page, the heading does not count
    expect(within(editor).getByText("Abs. 2")).toBeVisible();
    expect(within(editor).queryByText(/S\. /)).toBeNull();
    expect(within(editor).queryByText("Seite ungeprüft")).toBeNull();
    const created = view.data.cards.at(-1)?.frontmatter.locator;
    expect(created).toEqual({ label: "paragraph", start: "2", confirmed: true });
  });
});

describe("reader availability", () => {
  it("says so when the core has no reading files for the source", async () => {
    renderApp("/items/lewis2020retrieval?tab=read");
    expect(await screen.findByText("Diese Quelle lässt sich noch nicht lesen")).toBeVisible();
  });

  it("switches between overview and reader and keeps the card in the URL", async () => {
    const user = userEvent.setup();
    const { history } = renderApp("/items/luhmann1984soziale", reflowOnly());
    const first = (await screen.findAllByTestId("card"))[0] as HTMLElement;
    await user.click(within(first).getByRole("button", { name: "Im Reader zeigen" }));
    await screen.findByTestId("reflow-scroll");
    expect(history.location.search).toMatch(/tab=read/);
    expect(history.location.search).toMatch(/card=c_/);
    expect(await screen.findByTestId("card-editor")).toBeVisible();
  });
});
