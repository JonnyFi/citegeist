import { noteEditorAt } from "@citegeist/editor";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { renderApp } from "../test-utils";
import { publishPlanContext } from "./context";

afterEach(() => publishPlanContext(null));

const PLAN = "/projects/phd-proposal?tab=plan";

/** "number title" of every row of the outline, in order. */
async function outline(): Promise<string[]> {
  const rows = await screen.findAllByTestId("outline-node");
  return rows.map((r) => {
    const title = within(r).queryByRole("button", { name: /^\d/ });
    return title?.getAttribute("aria-label") ?? "";
  });
}

const row = (title: string) => {
  const found = screen
    .getAllByTestId("outline-node")
    .find((r) => within(r).queryByRole("button", { name: new RegExp(`\\d ${title}`) }));
  if (!found) throw new Error(`no outline row for ${title}`);
  return found;
};

const titleButton = (title: string) =>
  within(row(title)).getByRole("button", { name: new RegExp(`\\d ${title}`) });

function dragData() {
  const store = new Map<string, string>();
  return {
    dataTransfer: {
      effectAllowed: "",
      setData: (k: string, v: string) => store.set(k, v),
      getData: (k: string) => store.get(k) ?? "",
    },
  };
}

describe("outline", () => {
  it("shows computed numbers for chapters and sections", async () => {
    renderApp(PLAN);
    expect(await outline()).toEqual([
      "1 Einleitung",
      "1.1 Problemstellung",
      "1.2 Forschungsfragen",
      "2 Luhmanns Kommunikationsbegriff",
      "2.1 Anschlusskommunikation",
      "2.2 Autopoiesis",
      "3 Plattformen als soziale Systeme",
      "4 Methodik",
    ]);
  });

  it("moves a node up with the row button and numbers again", async () => {
    const user = userEvent.setup();
    const { calls } = renderApp(PLAN);
    await outline();
    await user.click(titleButton("Methodik"));
    await user.click(await screen.findByRole("button", { name: "Nach oben" }));

    await waitFor(async () =>
      expect((await outline()).slice(-2)).toEqual([
        "3 Methodik",
        "4 Plattformen als soziale Systeme",
      ]),
    );
    const apply = calls.find((c) => c.name === "outline.apply");
    expect(apply?.input).toMatchObject({
      project: "phd-proposal",
      plan: "expose",
      ops: [{ op: "move", parent: null, position: 3 }],
    });
  });

  it("indents a node below the previous one and outdents it again", async () => {
    const user = userEvent.setup();
    renderApp(PLAN);
    await outline();
    await user.click(titleButton("Methodik"));
    await user.click(await screen.findByRole("button", { name: "Einrücken" }));
    await waitFor(async () =>
      expect((await outline()).slice(-2)).toEqual([
        "3 Plattformen als soziale Systeme",
        "3.1 Methodik",
      ]),
    );
    await user.click(await screen.findByRole("button", { name: "Ausrücken" }));
    await waitFor(async () => expect((await outline()).at(-1)).toBe("4 Methodik"));
  });

  it("reorders by dragging a row onto another", async () => {
    const { calls } = renderApp(PLAN);
    await outline();
    const data = dragData();
    fireEvent.dragStart(row("Methodik"), data);
    fireEvent.dragOver(row("Einleitung"), data);
    fireEvent.drop(row("Einleitung"), data);

    await waitFor(async () =>
      expect((await outline()).filter((l) => /^\d /.test(l))).toEqual([
        "1 Einleitung",
        "2 Methodik",
        "3 Luhmanns Kommunikationsbegriff",
        "4 Plattformen als soziale Systeme",
      ]),
    );
    expect(calls.find((c) => c.name === "outline.apply")?.input).toMatchObject({
      ops: [{ op: "move", parent: null, position: 2 }],
    });
  });

  it("keeps a node where it is when it is dropped onto itself", async () => {
    const { calls } = renderApp(PLAN);
    await outline();
    const data = dragData();
    fireEvent.dragStart(row("Methodik"), data);
    fireEvent.drop(row("Methodik"), data);
    expect(calls.some((c) => c.name === "outline.apply")).toBe(false);
  });

  it("renames a node in place", async () => {
    const user = userEvent.setup();
    const { calls } = renderApp(PLAN);
    await outline();
    await user.dblClick(titleButton("Methodik"));
    const field = screen.getByRole("textbox", { name: "Umbenennen" });
    await user.clear(field);
    await user.type(field, "Methoden{Enter}");
    await waitFor(async () => expect((await outline()).at(-1)).toBe("4 Methoden"));
    expect(calls.find((c) => c.name === "outline.apply")?.input).toMatchObject({
      ops: [{ op: "update", title: "Methoden" }],
    });
  });

  it("cycles the status of a node from its row", async () => {
    const user = userEvent.setup();
    const { calls } = renderApp(PLAN);
    await outline();
    await user.click(within(row("Methodik")).getByRole("button", { name: /^Status Idee/ }));
    await waitFor(() =>
      expect(
        within(row("Methodik")).getByRole("button", { name: /^Status Entwurf/ }),
      ).toBeVisible(),
    );
    expect(calls.find((c) => c.name === "outline.apply")?.input).toMatchObject({
      ops: [{ op: "update", status: "draft" }],
    });
  });

  it("adds a section below the selected node and opens it", async () => {
    const user = userEvent.setup();
    renderApp(PLAN);
    await outline();
    await user.click(titleButton("Methodik"));
    await user.click(await screen.findByRole("button", { name: "Abschnitt darunter hinzufügen" }));
    await waitFor(async () => expect((await outline()).at(-1)).toBe("4.1 Neuer Abschnitt"));
    expect(await screen.findByRole("form", { name: "Eigenschaften von 4.1" })).toBeVisible();
  });

  it("asks before it removes a node and asks again when the node has a document", async () => {
    const user = userEvent.setup();
    const { calls } = renderApp(PLAN);
    await outline();
    await user.click(titleButton("Autopoiesis"));
    await user.click(await screen.findByRole("button", { name: "Entfernen" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/„Autopoiesis“/)).toBeVisible();
    await user.click(within(dialog).getByRole("button", { name: "Entfernen" }));
    expect(await within(dialog).findByText(/OUTLINE_REMOVE_NEEDS_FORCE/)).toBeVisible();
    await user.click(within(dialog).getByRole("button", { name: "Trotzdem entfernen" }));
    await waitFor(async () => expect(await outline()).not.toContain("2.2 Autopoiesis"));
    const removes = calls.filter((c) => c.name === "outline.apply");
    expect(removes.at(-1)?.input).toMatchObject({ force: true, ops: [{ op: "remove" }] });
  });

  it("saves purpose, status and questions of the open node", async () => {
    const user = userEvent.setup();
    const { calls } = renderApp(PLAN);
    await outline();
    await user.click(titleButton("Methodik"));
    const form = await screen.findByRole("form", { name: "Eigenschaften von 4" });
    const purpose = within(form).getByRole("textbox", { name: "Zweck" });
    await user.type(purpose, "Beschreibt das Vorgehen.");
    await user.tab();
    await user.click(within(form).getByRole("button", { name: "Gefestigt" }));
    await user.click(within(form).getByRole("button", { name: "FF 2" }));

    await waitFor(() => {
      const ops = calls
        .filter((c) => c.name === "outline.apply")
        .flatMap((c) => (c.input as { ops: unknown[] }).ops);
      expect(ops).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ op: "update", purpose: "Beschreibt das Vorgehen." }),
          expect.objectContaining({ op: "update", status: "solid" }),
          expect.objectContaining({ op: "update", questions: ["q2"] }),
        ]),
      );
    });
  });
});

describe("plans", () => {
  it("switches between the plans of a project", async () => {
    const user = userEvent.setup();
    renderApp(PLAN);
    await outline();
    await user.click(screen.getByRole("button", { name: "Paper Plattformen" }));
    await waitFor(async () =>
      expect(await outline()).toEqual([
        "1 Einleitung",
        "2 Methoden",
        "3 Ergebnisse",
        "4 Diskussion",
      ]),
    );
  });

  it("creates a plan from the IMRaD template when the project has none", async () => {
    const user = userEvent.setup();
    const { calls } = renderApp("/projects/rag-evaluation?tab=plan");
    expect(await screen.findByText("Dieses Projekt hat noch keinen Plan")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "IMRaD" }));
    const name = screen.getByRole("textbox", { name: "Name des Plans" });
    expect(name).toHaveValue("IMRaD");
    await user.click(screen.getByRole("button", { name: "Plan anlegen" }));

    expect(await outline()).toEqual(["1 Einleitung", "2 Methoden", "3 Ergebnisse", "4 Diskussion"]);
    expect(calls.find((c) => c.name === "plans.create")?.input).toEqual({
      project: "rag-evaluation",
      slug: "imrad",
      title: "IMRaD",
      template: "imrad",
    });
  });

  it("creates a second plan from the Exposé template under a free slug", async () => {
    const user = userEvent.setup();
    const { calls } = renderApp(PLAN);
    await outline();
    await user.click(screen.getByRole("button", { name: "Neuer Plan" }));
    const form = await screen.findByRole("form", { name: "Plan anlegen" });
    await user.click(within(form).getByRole("button", { name: "Plan anlegen" }));

    await waitFor(() =>
      expect(calls.find((c) => c.name === "plans.create")?.input).toEqual({
        project: "phd-proposal",
        slug: "expose-2",
        title: "Exposé",
        template: "expose",
      }),
    );
    await waitFor(async () => expect((await outline())[0]).toBe("1 Einleitung"));
    expect(await screen.findAllByRole("button", { name: "Exposé" })).toHaveLength(2);
  });

  it("creates an empty plan without a template", async () => {
    const user = userEvent.setup();
    const { calls } = renderApp("/projects/rag-evaluation?tab=plan");
    await screen.findByText("Dieses Projekt hat noch keinen Plan");
    await user.click(screen.getByRole("button", { name: "Leer" }));
    await user.click(screen.getByRole("button", { name: "Plan anlegen" }));
    expect(await screen.findByText("Diese Gliederung ist noch leer.")).toBeVisible();
    expect(calls.find((c) => c.name === "plans.create")?.input).not.toHaveProperty("template");
  });
});

describe("documents", () => {
  it("opens the document of a node in the editor and saves edits with the base hash", async () => {
    const { calls } = renderApp(PLAN);
    await outline();
    fireEvent.click(titleButton("Autopoiesis"));

    const content = await waitFor(() => {
      const el = document.querySelector<HTMLElement>(".cm-content");
      if (!el) throw new Error("editor not mounted yet");
      expect(el.textContent).toContain("Autopoiesis stammt aus der Biologie");
      return el;
    });
    const editor = noteEditorAt(content);
    if (!editor) throw new Error("no editor");
    act(() => {
      editor.view.dispatch({ changes: { from: editor.view.state.doc.length, insert: "Neu." } });
    });

    await waitFor(
      () => {
        const update = calls.find((c) => c.name === "plan.docs.update");
        expect(update?.input).toMatchObject({
          project: "phd-proposal",
          plan: "expose",
          doc: "k_01JC6A1B2D",
          baseHash: expect.stringMatching(/^[0-9a-f]{64}$/),
        });
        expect(String((update?.input as { body?: string } | undefined)?.body)).toContain("Neu.");
      },
      { timeout: 3000 },
    );
    await waitFor(() =>
      expect(screen.getByTestId("save-state")).toHaveAttribute("data-state", "saved"),
    );
  });

  it("opens the planning document for the plan row", async () => {
    renderApp(PLAN);
    await outline();
    const plan = screen.getByRole("button", { name: "Planungsdokument" });
    fireEvent.click(plan);
    await waitFor(() => {
      const el = document.querySelector<HTMLElement>(".cm-content");
      expect(el?.textContent).toContain("Das Exposé führt von Luhmanns Kommunikationsbegriff");
    });
  });
});

describe("insights", () => {
  it("reads the insights with insights.list and the documents with plan.docs.get", async () => {
    const { calls } = renderApp(`${PLAN}&view=insights`);
    await screen.findByRole("list", { name: "Einsichten" });
    const names = calls.map((c) => c.name);
    expect(names).toContain("insights.list");
    expect(names).not.toContain("insights.find");
    expect(calls.find((c) => c.name === "insights.list")?.input).toMatchObject({
      project: "phd-proposal",
    });
  });

  it("lists the insights with date, target node and sources, newest first", async () => {
    renderApp(`${PLAN}&view=insights`);
    const list = await screen.findByRole("list", { name: "Einsichten" });
    const items = within(list).getAllByTestId("insight");
    expect(items.map((i) => within(i).getByText(/^2026-/).textContent)).toEqual([
      "2026-10-22",
      "2026-10-21",
      "2026-10-20",
      "2026-10-18",
    ]);

    const second = items[1] as HTMLElement;
    expect(within(second).getByText("Selbstreferenz", { exact: false })).toBeVisible();
    // target node and the sources named in the paragraph
    expect(
      within(second).getByRole("button", { name: "2 Luhmanns Kommunikationsbegriff" }),
    ).toBeVisible();
    expect(within(second).getByRole("link", { name: "Luhmann 1984" })).toBeVisible();
    expect(within(second).getByRole("link", { name: "Latour 2005" })).toBeVisible();

    // an insight that links a node shows it as a number and title, and points at both nodes
    const first = items[3] as HTMLElement;
    expect(
      within(first).getAllByRole("button", { name: "2.1 Anschlusskommunikation" }),
    ).toHaveLength(2);
    // one that sits in no node names the planning document or the project file
    expect(
      within(items[0] as HTMLElement).getByRole("button", { name: "Einsichten des Projekts" }),
    ).toBeVisible();
    expect(
      within(items[2] as HTMLElement).getByRole("button", { name: "Planungsdokument" }),
    ).toBeVisible();
    expect(within(items[2] as HTMLElement).getByText("Keine Quelle verlinkt")).toBeVisible();
  });

  it("jumps to the node an insight belongs to", async () => {
    const user = userEvent.setup();
    renderApp(`${PLAN}&view=insights`);
    const list = await screen.findByRole("list", { name: "Einsichten" });
    const second = within(list).getAllByTestId("insight")[1] as HTMLElement;
    await user.click(
      within(second).getByRole("button", { name: "2 Luhmanns Kommunikationsbegriff" }),
    );
    expect(await screen.findByRole("form", { name: "Eigenschaften von 2" })).toBeVisible();
  });

  it("files an insight written by hand where the selection points", async () => {
    const user = userEvent.setup();
    const { calls } = renderApp(`${PLAN}&view=insights&node=k_01JC6A1B2D`);
    await screen.findByRole("list", { name: "Einsichten" });
    await user.type(
      screen.getByRole("textbox", { name: "Text der Einsicht" }),
      "Autopoiesis meint hier Selbstherstellung.",
    );
    await user.click(screen.getByRole("button", { name: "Festhalten" }));

    expect(await screen.findByText("Notiert in 2.2, Autopoiesis")).toBeVisible();
    expect(calls.find((c) => c.name === "insights.note")?.input).toEqual({
      project: "phd-proposal",
      plan: "expose",
      target: "k_01JC6A1B2D",
      text: "Autopoiesis meint hier Selbstherstellung.",
    });
    await waitFor(() => expect(screen.getAllByTestId("insight")).toHaveLength(5));
  });

  it("shows insights the agent notes in the chat without a reload", async () => {
    const user = userEvent.setup();
    renderApp(`${PLAN}&view=insights&node=k_01JC6A1B2C`);
    await screen.findByRole("list", { name: "Einsichten" });
    expect(screen.getAllByTestId("insight")).toHaveLength(4);

    await user.click(screen.getByRole("tab", { name: /^Agent/ }));
    const panel = await screen.findByTestId("chat-panel");
    expect(within(panel).getByTestId("chat-chip-plan")).toHaveTextContent(
      "Plan: Exposé, 2.1 Anschlusskommunikation",
    );
    await user.type(
      screen.getByRole("textbox", { name: "Nachricht an den Agent" }),
      "Ich sehe eine Verbindung zwischen Luhmann und Gillespie, bitte notieren",
    );
    await user.click(within(panel).getByRole("button", { name: "Senden" }));

    await waitFor(() => expect(screen.getAllByTestId("insight")).toHaveLength(5), {
      timeout: 5000,
    });
    expect(within(panel).getByText("Notiert in 2, Luhmanns Kommunikationsbegriff.")).toBeVisible();
    expect(screen.getAllByTestId("insight")[0]).toHaveTextContent("Ich sehe eine Verbindung");
  });
});

describe("gaps", () => {
  it("lists nodes without sources or insights and says why", async () => {
    renderApp(`${PLAN}&view=gaps`);
    const list = await screen.findByRole("list", { name: "Knoten mit Lücken" });
    const gaps = within(list).getAllByTestId("gap");
    const byTitle = (title: string) => {
      const found = gaps.find((g) => g.textContent?.includes(title));
      if (!found) throw new Error(`no gap for ${title}`);
      return found;
    };

    expect(screen.getByText("7 von 8 Knoten haben eine Lücke")).toBeVisible();
    // chapter 2 has sources in its document and insights: it is not listed
    expect(gaps.some((g) => g.textContent?.includes("Luhmanns Kommunikationsbegriff"))).toBe(false);
    // chapter 3 has neither
    expect(
      within(byTitle("Plattformen als soziale Systeme")).getByText("Keine Quelle"),
    ).toBeVisible();
    expect(
      within(byTitle("Plattformen als soziale Systeme")).getByText("Keine Einsicht"),
    ).toBeVisible();
    // section 2.1 has an insight (it is linked) but no document of its own
    expect(within(byTitle("Anschlusskommunikation")).getByText("Keine Quelle")).toBeVisible();
    expect(within(byTitle("Anschlusskommunikation")).queryByText("Keine Einsicht")).toBeNull();
    // section 2.2 has a source but no insight
    expect(within(byTitle("Autopoiesis")).queryByText("Keine Quelle")).toBeNull();
    expect(within(byTitle("Autopoiesis")).getByText("Keine Einsicht")).toBeVisible();
  });

  it("opens a node from the gap list", async () => {
    const user = userEvent.setup();
    renderApp(`${PLAN}&view=gaps`);
    const list = await screen.findByRole("list", { name: "Knoten mit Lücken" });
    const gap = within(list)
      .getAllByTestId("gap")
      .find((g) => g.textContent?.includes("Methodik")) as HTMLElement;
    await user.click(within(gap).getByRole("button", { name: "Öffnen" }));
    expect(await screen.findByRole("form", { name: "Eigenschaften von 4" })).toBeVisible();
  });
});
