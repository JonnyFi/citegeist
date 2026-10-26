import { citationCompletions, noteEditorAt, withInsertKind } from "@citegeist/editor";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { translator } from "../i18n";
import { createFixtures } from "../mock/fixtures";
import { createReflowFixtures, renderApp } from "../test-utils";
import { resetActiveText } from "./active";
import { createCitationProvider } from "./citations";
import { localizedError } from "./errors";
import { textsStoreFor } from "./mock";

afterEach(() => resetActiveText());

const TEXTS = "/projects/phd-proposal?tab=texts";

async function editor() {
  const content = await waitFor(() => {
    const el = document.querySelector<HTMLElement>(".cm-content");
    if (!el) throw new Error("editor not mounted yet");
    return el;
  });
  const instance = noteEditorAt(content);
  if (!instance) throw new Error("no editor");
  return { content, instance };
}

/** Citations on screen, as chips (known) or marks (unknown or being edited). */
const pieces = () => document.querySelectorAll(".cm-cite, .cm-cite-chip").length;

const chips = () => [...document.querySelectorAll(".cm-cite-chip")].map((el) => el.textContent);

const marks = () =>
  [...document.querySelectorAll(".cm-cite")].map((el) => ({
    text: el.textContent,
    unknown: el.classList.contains("cm-cite-unknown"),
  }));

describe("the Texte tab", () => {
  it("counts the texts in the tab and lists them with words and sources", async () => {
    renderApp(TEXTS);
    expect(await screen.findByRole("link", { name: /Texte/ })).toHaveTextContent("1");
    const rows = await screen.findAllByTestId("text-row");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent("Kapitel 2");
    expect(rows[0]).toHaveTextContent(/\d+ Wörter, 3 Quellen/);
  });

  it("opens the first text in the editor and shows the known citations as chips", async () => {
    const data = createFixtures();
    textsStoreFor(data).texts.get("phd-proposal")?.get("kapitel-2")?.body.concat("");
    renderApp(TEXTS, data);
    const { content } = await editor();
    await waitFor(() => expect(content.textContent).toContain("Luhmann setzt Kommunikation"));
    await waitFor(() => expect(chips()).toHaveLength(3));
    expect(chips()).toEqual([
      "(Luhmann, 1984, S. 31)",
      "(vgl. Habermas, 1981)",
      "(Gillespie, 2018)",
    ]);
    expect(marks()).toEqual([]);
    expect(screen.queryByTestId("unknown-citekeys")).toBeNull();
  });

  it("flags a citekey the library does not know, in the text and in a summary", async () => {
    renderApp(TEXTS);
    const { instance } = await editor();
    await waitFor(() => expect(pieces()).toBe(3));
    act(() => {
      instance.view.dispatch({
        changes: {
          from: instance.view.state.doc.length,
          insert: "\nNoch offen [@nobody2020none].",
        },
      });
    });
    await waitFor(() => expect(marks().at(-1)).toEqual({ text: "nobody2020none", unknown: true }));
    expect(screen.getByTestId("unknown-citekeys")).toHaveTextContent(
      "Ein Citekey steht nicht in der Bibliothek: nobody2020none",
    );
  });

  it("saves edits with the hash of the file and reports the state", async () => {
    const { calls } = renderApp(TEXTS);
    const { instance } = await editor();
    await waitFor(() => expect(pieces()).toBe(3));
    act(() => {
      instance.view.dispatch({ changes: { from: 0, insert: "Neu. " } });
    });
    await waitFor(
      () => {
        const update = calls.find((c) => c.name === "texts.update");
        expect(update?.input).toMatchObject({
          project: "phd-proposal",
          text: "kapitel-2",
          baseHash: expect.stringMatching(/^[0-9a-f]{64}$/),
        });
        expect(String((update?.input as { body?: string } | undefined)?.body)).toMatch(/^Neu\. /);
      },
      { timeout: 3000 },
    );
    await waitFor(() =>
      expect(screen.getByTestId("save-state")).toHaveAttribute("data-state", "saved"),
    );
  });

  it("completes @ from the library with the sources of the project first", async () => {
    renderApp(TEXTS);
    const { instance } = await editor();
    await waitFor(() => expect(pieces()).toBe(3));
    act(() => {
      instance.view.dispatch({
        changes: { from: instance.view.state.doc.length, insert: "\nSiehe [@" },
      });
    });
    const result = await citationCompletions(instance.view.state);
    const keys = result?.options.map((o) => o.label) ?? [];
    expect(keys.length).toBeGreaterThan(3);
    // luhmann1984soziale and habermas1981theorie belong to phd-proposal, gillespie does not
    const project = keys.indexOf("luhmann1984soziale");
    const other = keys.indexOf("gillespie2018custodians");
    expect(project).toBeGreaterThanOrEqual(0);
    expect(project).toBeLessThan(other);
    expect(result?.options[0]).toMatchObject({ section: { name: "Dieses Projekt" } });
  });

  it("finds quote cards after @ by their quote and inserts the chosen kind", async () => {
    const { calls } = renderApp(TEXTS);
    const { instance } = await editor();
    await waitFor(() => expect(pieces()).toBe(3));
    const end = instance.view.state.doc.length;
    act(() => {
      instance.view.focus();
      instance.view.dispatch({
        changes: { from: end, insert: "\nSiehe [@Kommunikationen" },
        selection: { anchor: end + "\nSiehe [@Kommunikationen".length },
      });
    });
    const result = await citationCompletions(instance.view.state);
    const cards = result?.options.filter((o) => o.type === "card") ?? [];
    expect(cards.length).toBeGreaterThan(0);
    expect(cards[0]?.label).toMatch(/Soziale Systeme bestehen aus Kommunikationen/);
    expect(cards[0]?.detail).toBe("Luhmann 1984, S. 31");
    expect(cards[0]?.section).toMatchObject({ name: "Karten" });

    // Shift+Enter writes the paraphrase with the "vgl." citation
    const option = cards[0];
    const apply = option?.apply;
    if (!option || !result || typeof apply !== "function") throw new Error("no card option");
    const head = instance.view.state.selection.main.head;
    act(() => {
      withInsertKind("indirect", () => apply(instance.view, option, result.from, head));
    });
    await waitFor(() =>
      expect(instance.getValue()).toMatch(/Siehe \S[^\n]*\[vgl\. @luhmann1984soziale, S\. 31\]\.$/),
    );
    expect(calls.find((c) => c.name === "cards.export")?.input).toMatchObject({
      mode: "indirect",
      format: "pandoc",
      project: "phd-proposal",
      locale: "de-DE",
    });
  });

  it("creates a text from its title and opens it", async () => {
    const user = userEvent.setup();
    const { calls } = renderApp(TEXTS);
    await screen.findAllByTestId("text-row");
    await user.click(screen.getByRole("button", { name: "Neuer Text" }));
    await user.type(await screen.findByLabelText("Titel"), "Kapitel 3");
    await user.click(screen.getByRole("button", { name: "Text anlegen" }));

    await waitFor(() => expect(screen.getAllByTestId("text-row")).toHaveLength(2));
    expect(calls.find((c) => c.name === "texts.create")?.input).toMatchObject({
      project: "phd-proposal",
      title: "Kapitel 3",
    });
    await waitFor(() =>
      expect(screen.getByRole("region", { name: "Inhalt des Texts" })).toHaveTextContent(
        "projects/phd-proposal/texts/kapitel-3.md",
      ),
    );
  });

  it("changes style and language in the frontmatter", async () => {
    const user = userEvent.setup();
    const { calls } = renderApp(TEXTS);
    await editor();
    await user.click(screen.getByRole("combobox", { name: "Zitierstil" }));
    await user.click(await screen.findByRole("option", { name: "Chicago (Autor-Jahr)" }));
    await waitFor(() =>
      expect(
        calls.find((c) => c.name === "texts.update" && "style" in (c.input as object))?.input,
      ).toMatchObject({
        project: "phd-proposal",
        text: "kapitel-2",
        style: "chicago-author-date",
      }),
    );
  });
});

describe("citation chips", () => {
  it("restyle at once when the citation style of the text changes", async () => {
    const user = userEvent.setup();
    renderApp(TEXTS);
    await editor();
    await waitFor(() =>
      expect(chips()).toEqual([
        "(Luhmann, 1984, S. 31)",
        "(vgl. Habermas, 1981)",
        "(Gillespie, 2018)",
      ]),
    );
    await user.click(screen.getByRole("combobox", { name: "Zitierstil" }));
    await user.click(await screen.findByRole("option", { name: "Chicago (Autor-Jahr)" }));
    await waitFor(() =>
      expect(chips()).toEqual(["(Luhmann 1984, 31)", "(vgl. Habermas 1981)", "(Gillespie 2018)"]),
    );
    await user.click(screen.getByRole("combobox", { name: "Zitierstil" }));
    await user.click(await screen.findByRole("option", { name: "APA" }));
    await waitFor(() => expect(chips()[0]).toBe("(Luhmann, 1984, S. 31)"));
  });

  it("follow the language of the text in the locator terms", async () => {
    const user = userEvent.setup();
    renderApp(TEXTS);
    await editor();
    await waitFor(() => expect(chips()).toHaveLength(3));
    await user.click(screen.getByRole("combobox", { name: "Sprache" }));
    await user.click(await screen.findByRole("option", { name: "Englisch (USA)" }));
    await waitFor(() => expect(chips()[0]).toBe("(Luhmann, 1984, p. 31)"));
  });

  it("keep the Pandoc syntax in the file and show it again when the cursor enters", async () => {
    renderApp(TEXTS);
    const { instance } = await editor();
    await waitFor(() => expect(chips()).toHaveLength(3));
    expect(instance.getValue()).toContain("[@luhmann1984soziale, S. 31]");
    expect(document.querySelector(".cm-content")?.textContent).not.toContain("@luhmann1984soziale");
    const at = instance.getValue().indexOf("@luhmann1984soziale") + 3;
    act(() => {
      instance.view.focus();
      instance.view.dispatch({ selection: { anchor: at } });
    });
    await waitFor(() =>
      expect(document.querySelector(".cm-content")?.textContent).toContain(
        "[@luhmann1984soziale, S. 31]",
      ),
    );
    expect(chips()).toHaveLength(2);
  });

  it("draw clusters of a new citation only for sources the library knows", async () => {
    renderApp(TEXTS);
    const { instance } = await editor();
    await waitFor(() => expect(chips()).toHaveLength(3));
    act(() => {
      instance.view.dispatch({
        changes: {
          from: instance.view.state.doc.length,
          insert: "\nNoch offen [@nobody2020none].",
        },
      });
    });
    await waitFor(() => expect(marks().at(-1)).toEqual({ text: "nobody2020none", unknown: true }));
    expect(chips()).toHaveLength(3);
  });
});

describe("Belege erkennen", () => {
  const PLAIN =
    "\nEr schreibt: „Das gilt.“ (Luhmann, 1984, S. 31) und sinngemäß (vgl. Habermas, 1981).\n";

  it("stays away while the text has no plain citation", async () => {
    renderApp(TEXTS);
    await editor();
    await waitFor(() => expect(chips()).toHaveLength(3));
    expect(screen.queryByRole("button", { name: /Belege erkennen/ })).toBeNull();
  });

  it("offers to convert plain citations after the person confirms, and the chips follow the style", async () => {
    const user = userEvent.setup();
    renderApp(TEXTS);
    const { instance } = await editor();
    await waitFor(() => expect(chips()).toHaveLength(3));
    act(() => {
      instance.view.dispatch({ changes: { from: instance.view.state.doc.length, insert: PLAIN } });
    });
    const button = await screen.findByRole("button", { name: "Belege erkennen (2)" });
    // nothing changes before the person agrees
    expect(instance.getValue()).toContain("(Luhmann, 1984, S. 31) und");
    await user.click(button);
    const region = await screen.findByRole("region", { name: "Belege als Text" });
    expect(region).toHaveTextContent("2 Belege stehen als gewöhnlicher Text im Dokument");
    expect(region).toHaveTextContent("(Luhmann, 1984, S. 31)");
    await user.click(within(region).getByRole("button", { name: "Abbrechen" }));
    expect(instance.getValue()).toContain("(Luhmann, 1984, S. 31) und");

    await user.click(screen.getByRole("button", { name: "Belege erkennen (2)" }));
    await user.click(screen.getByRole("button", { name: "Umwandeln" }));
    expect(instance.getValue()).toContain(
      "„Das gilt.“ [@luhmann1984soziale, S. 31] und sinngemäß [vgl. @habermas1981theorie].",
    );
    await waitFor(() => expect(chips()).toHaveLength(5));
    expect(screen.queryByRole("button", { name: /Belege erkennen/ })).toBeNull();

    await user.click(screen.getByRole("combobox", { name: "Zitierstil" }));
    await user.click(await screen.findByRole("option", { name: "Chicago (Autor-Jahr)" }));
    await waitFor(() =>
      expect(chips().slice(3)).toEqual(["(Luhmann 1984, 31)", "(vgl. Habermas 1981)"]),
    );
  });
});

describe("the empty project", () => {
  it("offers to create the first text", async () => {
    const data = createFixtures();
    textsStoreFor(data).texts.set("phd-proposal", new Map());
    renderApp(TEXTS, data);
    expect(await screen.findByText("Dieses Projekt hat noch keinen Text")).toBeVisible();
    expect(screen.getByRole("form", { name: "Text anlegen" })).toBeVisible();
  });
});

describe("export", () => {
  it("exports Word and shows where the file went", async () => {
    const user = userEvent.setup();
    const { calls } = renderApp(TEXTS);
    await editor();
    await user.click(screen.getByRole("button", { name: "Word" }));
    const result = await screen.findByTestId("export-result");
    expect(result).toHaveTextContent(
      "Exportiert nach /Users/alex/Citegeist/projects/phd-proposal/exports/kapitel-2.docx",
    );
    expect(calls.find((c) => c.name === "texts.export")?.input).toEqual({
      project: "phd-proposal",
      text: "kapitel-2",
      format: "docx",
    });
  });

  it("saves pending edits before it exports", async () => {
    const user = userEvent.setup();
    const { calls } = renderApp(TEXTS);
    const { instance } = await editor();
    await waitFor(() => expect(pieces()).toBe(3));
    act(() => {
      instance.view.dispatch({ changes: { from: 0, insert: "Frisch. " } });
    });
    await user.click(screen.getByRole("button", { name: "LaTeX" }));
    await screen.findByTestId("export-result");
    const names = calls
      .map((c) => c.name)
      .filter((n) => n === "texts.update" || n === "texts.export");
    expect(names).toEqual(["texts.update", "texts.export"]);
  });

  it("names the citekeys that stay unresolved in the export", async () => {
    const user = userEvent.setup();
    renderApp(TEXTS);
    const { instance } = await editor();
    await waitFor(() => expect(pieces()).toBe(3));
    act(() => {
      instance.view.dispatch({
        changes: { from: instance.view.state.doc.length, insert: "\n[@nobody2020none]" },
      });
    });
    await user.click(screen.getByRole("button", { name: "Markdown" }));
    const result = await screen.findByTestId("export-result");
    expect(result).toHaveTextContent(
      "Nicht in der Bibliothek und deshalb unaufgelöst im Export: nobody2020none",
    );
  });

  it("asks before it downloads Typst for a PDF and exports once the download is done", async () => {
    const user = userEvent.setup();
    const { calls } = renderApp(TEXTS);
    await editor();
    await user.click(screen.getByRole("button", { name: "PDF" }));
    const ask = await screen.findByTestId("typst-ask");
    expect(ask).toHaveTextContent("Für PDF lädt citegeist einmal Typst (etwa 14 MB). Jetzt laden?");
    // nothing is downloaded or exported before the answer
    expect(calls.some((c) => c.name === "typst.setup" || c.name === "texts.export")).toBe(false);

    await user.click(within(ask).getByRole("button", { name: "Laden" }));
    expect(calls.some((c) => c.name === "typst.setup")).toBe(true);
    expect(await screen.findByTestId("typst-progress")).toHaveTextContent("Typst wird geladen");
    const result = await screen.findByTestId("export-result", undefined, { timeout: 5000 });
    expect(result).toHaveTextContent("kapitel-2.pdf");
    expect(calls.find((c) => c.name === "texts.export")?.input).toMatchObject({ format: "pdf" });
    expect(screen.queryByTestId("typst-ask")).toBeNull();
    expect(screen.queryByTestId("typst-progress")).toBeNull();
  });

  it("exports a PDF without a question once Typst is there", async () => {
    const user = userEvent.setup();
    const data = createFixtures();
    textsStoreFor(data).typst.found = true;
    const { calls } = renderApp(TEXTS, data);
    await editor();
    await user.click(screen.getByRole("button", { name: "PDF" }));
    expect(await screen.findByTestId("export-result")).toHaveTextContent("kapitel-2.pdf");
    expect(calls.some((c) => c.name === "typst.setup")).toBe(false);
    expect(screen.queryByTestId("typst-ask")).toBeNull();
  });

  it("leaves everything as it is when the person declines the download", async () => {
    const user = userEvent.setup();
    const { calls } = renderApp(TEXTS);
    await editor();
    await user.click(screen.getByRole("button", { name: "PDF" }));
    await user.click(
      within(await screen.findByTestId("typst-ask")).getByRole("button", { name: "Abbrechen" }),
    );
    expect(screen.queryByTestId("typst-ask")).toBeNull();
    expect(calls.some((c) => c.name === "typst.setup" || c.name === "texts.export")).toBe(false);
  });

  it("says in German that a PDF has no engine where Typst cannot be downloaded", async () => {
    const user = userEvent.setup();
    const data = createFixtures();
    textsStoreFor(data).typst.installable = false;
    renderApp(TEXTS, data);
    await editor();
    await user.click(screen.getByRole("button", { name: "PDF" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Für ein PDF fehlt Typst oder ein LaTeX-Programm.");
    expect(alert).toHaveTextContent("Installiere Typst mit „brew install typst“");
    expect(alert).not.toHaveTextContent("A PDF needs");
  });

  it("shows an export error of the core in the UI language and keeps an unknown one as it is", async () => {
    const user = userEvent.setup();
    const data = createFixtures();
    textsStoreFor(data).pandoc.found = false;
    renderApp(TEXTS, data);
    await editor();
    await user.click(screen.getByRole("button", { name: "Word" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Pandoc fehlt oder ist zu alt.");
    expect(alert).not.toHaveTextContent("was not found");
  });
});

describe("error messages", () => {
  const tr = translator("de");

  it("translates a known code and fills in the detail", () => {
    expect(
      localizedError(tr, {
        code: "PANDOC_FAILED",
        message: "Pandoc could not export x: boom",
        fix: "Fix it.",
        context: { detail: "boom", exitCode: 64 },
      }),
    ).toEqual({
      message: "Pandoc konnte den Text nicht exportieren: boom",
      fix: "Behebe das genannte Problem im Text oder exportiere als Word oder LaTeX.",
    });
  });

  it("keeps the message of the core for a code the catalog does not know", () => {
    expect(
      localizedError(tr, { code: "SOMETHING_NEW", message: "English", fix: "Do it." }),
    ).toEqual({ message: "English", fix: "Do it." });
    expect(localizedError(tr, { message: "No code" })).toEqual({ message: "No code" });
  });

  it("has a German and an English message for every code the export and the setups throw", () => {
    const codes = [
      "PANDOC_MISSING",
      "PANDOC_FAILED",
      "PANDOC_TIMEOUT",
      "PDF_ENGINE_MISSING",
      "TEXT_UNKNOWN_STYLE",
      "TEXT_NOT_FOUND",
      ...["PANDOC", "TYPST"].flatMap((tool) =>
        ["NOT_INSTALLABLE", "DOWNLOAD_FAILED", "CHECKSUM", "UNPACK_FAILED", "UNUSABLE"].map(
          (c) => `${tool}_${c}`,
        ),
      ),
    ];
    for (const lang of ["de", "en"] as const) {
      const t = translator(lang);
      for (const code of codes) {
        expect(t.has(`texts.error.${code}`), `${lang} ${code}`).toBe(true);
        expect(t.has(`texts.error.${code}.fix`), `${lang} ${code}.fix`).toBe(true);
      }
    }
  });
});

describe("Pandoc", () => {
  it("stays quiet while Pandoc is there", async () => {
    renderApp(TEXTS);
    await editor();
    expect(screen.queryByText("Pandoc fehlt. Der Export braucht es.")).toBeNull();
  });

  it("offers the download when Pandoc is missing and goes away once it is installed", async () => {
    const user = userEvent.setup();
    const data = createFixtures();
    textsStoreFor(data).pandoc.found = false;
    const { calls } = renderApp(TEXTS, data);
    expect(await screen.findByText("Pandoc fehlt. Der Export braucht es.")).toBeVisible();
    expect(screen.getByText("Installiere es mit „brew install pandoc“.")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Pandoc laden" }));
    expect(calls.some((c) => c.name === "pandoc.setup")).toBe(true);
    await waitFor(
      () => expect(screen.queryByText("Pandoc fehlt. Der Export braucht es.")).toBeNull(),
      {
        timeout: 5000,
      },
    );
  });

  it("shows only the manual hint where the download is not offered", async () => {
    const data = createFixtures();
    const store = textsStoreFor(data);
    store.pandoc.found = false;
    store.pandoc.installable = false;
    renderApp(TEXTS, data);
    await screen.findByText("Pandoc fehlt. Der Export braucht es.");
    expect(screen.queryByRole("button", { name: "Pandoc laden" })).toBeNull();
  });
});

describe("quote cards", () => {
  async function openCard(
    user: ReturnType<typeof userEvent.setup>,
    snippet = /Soziale Systeme bestehen/,
  ) {
    await editor();
    await waitFor(() => expect(pieces()).toBe(3));
    const rows = await screen.findAllByTestId("panel-card");
    const row = rows.find((r) => snippet.test(r.textContent ?? ""));
    if (!row) throw new Error("card row not found");
    await user.click(within(row).getByRole("button", { expanded: false }));
    return screen.findByTestId("card-editor");
  }

  it("inserts a verbatim quotation with its citation at the end of an untouched text", async () => {
    const user = userEvent.setup();
    renderApp(TEXTS);
    const card = await openCard(user);
    await user.click(within(card).getByRole("button", { name: "Wörtlich zitieren" }));
    expect(await within(card).findByText("Eingefügt in „Kapitel 2“")).toBeVisible();
    const { instance } = await editor();
    expect(instance.getValue()).toMatch(
      /Soziale Systeme bestehen aus Kommunikationen[^\n]*\[@luhmann1984soziale, S\. 31\]\.\n$/,
    );
    await waitFor(() => expect(pieces()).toBe(4));
  });

  it("inserts at the cursor once the person has put it somewhere", async () => {
    const user = userEvent.setup();
    const { calls } = renderApp(TEXTS);
    const card = await openCard(user);
    const { instance } = await editor();
    const at = instance.getValue().indexOf("Plattformen");
    act(() => {
      instance.view.dispatch({ selection: { anchor: at } });
    });
    await user.click(within(card).getByRole("button", { name: "Sinngemäß zitieren" }));
    await within(card).findByText("Eingefügt in „Kapitel 2“");
    expect(calls.find((c) => c.name === "cards.export")?.input).toMatchObject({
      mode: "indirect",
      format: "pandoc",
      project: "phd-proposal",
    });
    expect(instance.getValue()).toMatch(/\[vgl\. @luhmann1984soziale, S\. 31\]\.Plattformen/);
  });

  it("inserts the citation alone from the menu of the card", async () => {
    const user = userEvent.setup();
    const { calls } = renderApp(TEXTS);
    const card = await openCard(user);
    expect(within(card).queryByRole("button", { name: "Nur Beleg" })).toBeNull();
    await user.click(within(card).getByRole("button", { name: "Weitere Aktionen" }));
    await user.click(await screen.findByRole("menuitem", { name: "Nur Beleg" }));
    await within(card).findByText("Eingefügt in „Kapitel 2“");
    expect(calls.find((c) => c.name === "cards.export")?.input).toMatchObject({
      mode: "cite",
      format: "pandoc",
      project: "phd-proposal",
    });
    const { instance } = await editor();
    expect(instance.getValue()).toMatch(/\n\n\[@luhmann1984soziale, S\. 31\]\n$/);
  });

  it("still inserts into the last open text after the person left the tab", async () => {
    const user = userEvent.setup();
    const data = createReflowFixtures();
    const view = renderApp(TEXTS, data);
    await editor();
    await waitFor(() => expect(pieces()).toBe(3));
    await act(async () => {
      await view.history.push("/items/luhmann1984soziale?tab=read");
    });
    await screen.findAllByTestId("panel-card");
    const row = screen
      .getAllByTestId("panel-card")
      .find((r) => /Soziale Systeme bestehen/.test(r.textContent ?? ""));
    if (!row) throw new Error("card row not found");
    await user.click(within(row).getByRole("button", { expanded: false }));
    const card = await screen.findByTestId("card-editor");
    await user.click(within(card).getByRole("button", { name: "Wörtlich zitieren" }));
    expect(await within(card).findByText("Eingefügt in „Kapitel 2“")).toBeVisible();
    const saved = textsStoreFor(data).texts.get("phd-proposal")?.get("kapitel-2")?.body ?? "";
    expect(saved).toContain("[@luhmann1984soziale, S. 31]");
    expect(saved).toContain("Luhmann setzt Kommunikation");
  });

  it("copies to the clipboard as before when no text was opened", async () => {
    const user = userEvent.setup();
    const { calls } = renderApp("/items/luhmann1984soziale?tab=read", createReflowFixtures());
    await screen.findAllByTestId("panel-card");
    const row = screen
      .getAllByTestId("panel-card")
      .find((r) => /Soziale Systeme bestehen/.test(r.textContent ?? ""));
    if (!row) throw new Error("card row not found");
    await user.click(within(row).getByRole("button", { expanded: false }));
    const card = await screen.findByTestId("card-editor");
    await user.click(within(card).getByRole("button", { name: "Wörtlich zitieren" }));
    await waitFor(() =>
      expect(calls.find((c) => c.name === "cards.export")?.input).toMatchObject({ format: "html" }),
    );
  });
});

describe("the chat", () => {
  it("tells the agent which text is open", async () => {
    const user = userEvent.setup();
    renderApp(TEXTS);
    await editor();
    await user.click(screen.getByRole("tab", { name: /^Agent/ }));
    const panel = await screen.findByTestId("chat-panel");
    expect(within(panel).getByTestId("chat-chip-text")).toHaveTextContent("Text: Kapitel 2");
  });
});

describe("createCitationProvider", () => {
  const items = [
    { citekey: "luhmann1984soziale", title: "Soziale Systeme", authors: "Luhmann", year: "1984" },
    {
      citekey: "gillespie2018custodians",
      title: "Custodians of the Internet",
      authors: "Gillespie",
      year: "2018",
    },
  ];

  it("lists project sources first and resolves known keys only", async () => {
    const provider = createCitationProvider(items, new Set(["gillespie2018custodians"]));
    expect((await provider.suggest("")).map((s) => s.key)).toEqual([
      "gillespie2018custodians",
      "luhmann1984soziale",
    ]);
    expect(provider.resolve("luhmann1984soziale")).toEqual({ title: "Soziale Systeme" });
    expect(provider.resolve("nobody2020none")).toBeUndefined();
    expect((await provider.suggest("luhmann"))[0]).toMatchObject({
      key: "luhmann1984soziale",
      detail: "Luhmann 1984",
      group: "library",
    });
  });

  it("offers quote cards after the sources, with the page, and inserts through insertCard", async () => {
    const insertCard = async (id: string, kind: string) => `${kind}:${id}`;
    const provider = createCitationProvider(items, new Set(["luhmann1984soziale"]), {
      cards: [
        {
          id: "c_1",
          citekey: "luhmann1984soziale",
          quote: "Soziale Systeme bestehen aus Kommunikationen.",
          where: "S. 31",
        },
        { id: "c_2", citekey: "nobody2020none", quote: "Unknown source", where: "S. 1" },
      ],
      insertCard,
    });
    const found = await provider.suggest("kommunikation");
    expect(found).toEqual([
      expect.objectContaining({
        kind: "card",
        id: "c_1",
        key: "luhmann1984soziale",
        detail: "Luhmann 1984, S. 31",
        group: "project",
      }),
    ]);
    const all = await provider.suggest("");
    expect(all.map((s) => s.kind ?? "source")).toEqual(["source", "source", "card"]);
    expect(await provider.insertCard?.("c_1", "cite")).toBe("cite:c_1");
  });
});
