import { matrixCreate } from "@citegeist/ops";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFixtures } from "../mock/fixtures";
import { renderApp } from "../test-utils";
import { exportMatrix } from "./mock";

const saved = vi.hoisted(() => [] as Array<{ name: string; mime: string; text: string }>);
vi.mock("../lib/clipboard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/clipboard")>()),
  downloadText: (name: string, mime: string, text: string) => saved.push({ name, mime, text }),
}));

beforeEach(() => {
  saved.length = 0;
});

const TAB = "/projects/phd-proposal?tab=matrix";

/** Opens the matrix tab of the PhD project with a matrix of two sources and two questions. */
async function withMatrix(path = TAB, options: Parameters<typeof renderApp>[2] = {}) {
  const ctx = renderApp(path, undefined, options);
  await screen.findByText("Dieses Projekt hat noch keine Matrix");
  const out = await ctx.core.call(matrixCreate, {
    project: "phd-proposal",
    title: "Systemtheorie",
    columns: [
      { name: "Fragestellung", instruction: "Welche Frage untersucht die Quelle?" },
      { name: "Methode", instruction: "Wie wurde untersucht?" },
    ],
    items: ["luhmann1984soziale", "latour2005reassembling"],
  });
  await screen.findByRole("table", { name: "Literaturmatrix" });
  return { ...ctx, id: out.matrix.id };
}

function cellFor(citekey: string, column: string): HTMLElement {
  const row = screen
    .getAllByTestId("matrix-row")
    .find((r) => r.getAttribute("data-citekey") === citekey);
  if (!row) throw new Error(`no row ${citekey}`);
  const cell = within(row)
    .getAllByTestId("matrix-cell")
    .find((c) => c.getAttribute("data-column") === column);
  if (!cell) throw new Error(`no cell ${citekey} / ${column}`);
  return cell;
}

describe("matrix tab", () => {
  it("shows an empty state with the way to a first matrix", async () => {
    renderApp(TAB);
    expect(await screen.findByText("Dieses Projekt hat noch keine Matrix")).toBeVisible();
    expect(screen.getByRole("link", { name: /^Matrix$/ })).toHaveAttribute("aria-current", "page");
  });

  it("creates a matrix from chosen items and columns with instructions", async () => {
    const user = userEvent.setup();
    const { calls } = renderApp(TAB);
    await user.click(await screen.findByRole("button", { name: "Neue Matrix" }));
    const form = await screen.findByRole("form", { name: "Matrix anlegen" });
    await within(form).findByRole("checkbox", { name: /Reassembling the Social/ });

    await user.clear(within(form).getByRole("textbox", { name: "Name der Matrix" }));
    await user.type(
      within(form).getByRole("textbox", { name: "Name der Matrix" }),
      "Kommunikation",
    );
    // the sources of the project start out chosen; drop one
    await user.click(within(form).getByRole("checkbox", { name: /Reassembling the Social/ }));
    await user.click(within(form).getByRole("button", { name: "Methode" }));
    await user.type(within(form).getByRole("textbox", { name: "Name der Spalte 1" }), " und Daten");
    await user.click(within(form).getByRole("button", { name: "Matrix anlegen" }));

    const table = await screen.findByRole("table", { name: "Literaturmatrix" });
    expect(within(table).getByRole("columnheader", { name: /Methode und Daten/ })).toBeVisible();
    expect(screen.getAllByTestId("matrix-row")).toHaveLength(2);
    const call = calls.find((c) => c.name === "matrix.create");
    expect(call?.input).toMatchObject({
      project: "phd-proposal",
      title: "Kommunikation",
      columns: [
        {
          name: "Methode und Daten",
          instruction: "Wie wurde untersucht? Design, Daten und Auswertung.",
        },
      ],
      items: ["habermas1981theorie", "luhmann1984soziale"],
    });
  });

  it("does not create a matrix without a column name", async () => {
    const user = userEvent.setup();
    renderApp(TAB);
    await user.click(await screen.findByRole("button", { name: "Neue Matrix" }));
    expect(await screen.findByRole("button", { name: "Matrix anlegen" })).toBeDisabled();
  });
});

describe("filling cells", () => {
  it("fills one cell and shows answer, evidence, status and provenance", async () => {
    const user = userEvent.setup();
    const { calls } = await withMatrix();
    expect(cellFor("luhmann1984soziale", "Fragestellung")).toHaveAttribute("data-status", "empty");
    await user.click(screen.getByRole("button", { name: "Füllen: Luhmann 1984, Fragestellung" }));
    await waitFor(() =>
      expect(cellFor("luhmann1984soziale", "Fragestellung")).toHaveAttribute(
        "data-status",
        "filled",
      ),
    );
    const cell = cellFor("luhmann1984soziale", "Fragestellung");
    expect(within(cell).getByText(/Soziale Systeme bestehen aus Kommunikationen/)).toBeVisible();
    expect(within(cell).getByText("Gefüllt")).toBeVisible();
    expect(within(cell).getByText(/claude-code:sonnet/)).toBeVisible();
    expect(within(cell).getByTestId("evidence")).toBeVisible();
    // the other cells stay as they were
    expect(cellFor("luhmann1984soziale", "Methode")).toHaveAttribute("data-status", "empty");
    expect(calls.filter((c) => c.name === "matrix.fillCell")).toHaveLength(1);
  });

  it("shows a cell the model is writing", async () => {
    const user = userEvent.setup();
    // The mock writes a cell after aiDelayMs / 5 (at least 5 ms). With the default delay the cell can
    // already be filled when the assertion runs on a loaded machine, so the delay is far beyond the test.
    await withMatrix(TAB, { aiDelayMs: 600_000 });
    await user.click(screen.getByRole("button", { name: "Füllen: Luhmann 1984, Fragestellung" }));
    expect(cellFor("luhmann1984soziale", "Fragestellung")).toHaveAttribute(
      "data-status",
      "filling",
    );
    expect(
      within(cellFor("luhmann1984soziale", "Fragestellung")).getByText("KI schreibt"),
    ).toBeVisible();
  });

  it("fills all open cells as one job with progress and marks failures", async () => {
    const user = userEvent.setup();
    // One cell per second, so a slow CI runner still sees the progress bar while the job runs.
    const { calls } = await withMatrix(TAB, { aiDelayMs: 5000 });
    await user.click(screen.getByRole("button", { name: "Offene Zellen füllen" }));
    const bar = await screen.findByRole("progressbar", { name: "Zellen werden gefüllt" });
    expect(bar).toBeVisible();
    await waitFor(() =>
      expect(cellFor("luhmann1984soziale", "Methode")).toHaveAttribute("data-status", "filled"),
    );
    await waitFor(() =>
      expect(cellFor("latour2005reassembling", "Methode")).toHaveAttribute("data-status", "failed"),
    );
    const failed = cellFor("latour2005reassembling", "Methode");
    expect(within(failed).getByText("Fehlgeschlagen")).toBeVisible();
    expect(within(failed).getByText(/NO_SOURCE_TEXT/)).toBeVisible();
    expect(within(failed).getByRole("button", { name: "Erneut versuchen" })).toBeVisible();
    expect(screen.getByText(/2 von 4 Zellen gefüllt · 2 fehlgeschlagen/)).toBeVisible();
    expect(calls.find((c) => c.name === "matrix.fill")?.input).toMatchObject({ force: false });
    await waitFor(() =>
      expect(
        screen.queryByRole("progressbar", { name: "Zellen werden gefüllt" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("refills a filled cell only when asked to", async () => {
    const user = userEvent.setup();
    const { calls } = await withMatrix();
    await user.click(screen.getByRole("button", { name: "Offene Zellen füllen" }));
    await waitFor(() =>
      expect(cellFor("luhmann1984soziale", "Methode")).toHaveAttribute("data-status", "filled"),
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Offene Zellen füllen" })).toBeEnabled(),
    );
    await user.click(
      within(cellFor("luhmann1984soziale", "Methode")).getByRole("button", { name: "Neu füllen" }),
    );
    await waitFor(() =>
      expect(calls.filter((c) => c.name === "matrix.fillCell").at(-1)?.input).toMatchObject({
        item: "luhmann1984soziale",
        force: true,
      }),
    );
  });
});

describe("evidence", () => {
  it("opens the card in the reader", async () => {
    const user = userEvent.setup();
    const { history } = await withMatrix();
    await user.click(screen.getByRole("button", { name: "Füllen: Luhmann 1984, Fragestellung" }));
    const link = await within(cellFor("luhmann1984soziale", "Fragestellung")).findByRole("link", {
      name: /Im Reader öffnen: Karte S\. 31/,
    });
    await user.click(link);
    await waitFor(() => expect(history.location.pathname).toBe("/items/luhmann1984soziale"));
    expect(history.location.search).toMatch(/tab=read/);
    expect(history.location.search).toMatch(/card=c_/);
  });

  it("opens the page of a passage in the reader at its reading position", async () => {
    const user = userEvent.setup();
    const { history } = await withMatrix();
    await user.click(screen.getByRole("button", { name: "Füllen: Luhmann 1984, Methode" }));
    const button = await within(cellFor("luhmann1984soziale", "Methode")).findByRole("button", {
      name: /Im Reader öffnen: Stelle S\./,
    });
    await user.click(button);
    await waitFor(() => expect(history.location.pathname).toBe("/items/luhmann1984soziale"));
    expect(history.location.search).toMatch(/tab=read/);
    expect(history.location.search).toMatch(/resume/);
    expect(
      JSON.parse(localStorage.getItem("citegeist.reading.luhmann1984soziale") ?? "{}"),
    ).toMatchObject({
      page: expect.any(Number),
    });
  });
});

describe("editing", () => {
  it("lets a person write and change an answer; it counts as by hand", async () => {
    const user = userEvent.setup();
    const { calls } = await withMatrix();
    const cell = cellFor("latour2005reassembling", "Fragestellung");
    await user.click(within(cell).getByRole("button", { name: "Von Hand schreiben" }));
    await user.type(
      screen.getByRole("textbox", { name: "Antwort: Latour 2005, Fragestellung" }),
      "Wie entstehen Netzwerke aus Akteuren?",
    );
    await user.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() =>
      expect(cellFor("latour2005reassembling", "Fragestellung")).toHaveAttribute(
        "data-status",
        "edited",
      ),
    );
    const edited = cellFor("latour2005reassembling", "Fragestellung");
    expect(within(edited).getByText("Wie entstehen Netzwerke aus Akteuren?")).toBeVisible();
    expect(within(edited).getAllByText(/Von Hand/).length).toBeGreaterThan(0);
    expect(
      calls.find((c) => c.name === "matrix.update" && JSON.stringify(c.input).includes("setCell"))
        ?.input,
    ).toMatchObject({
      ops: [
        {
          op: "setCell",
          item: "latour2005reassembling",
          answer: "Wie entstehen Netzwerke aus Akteuren?",
        },
      ],
    });

    await user.click(within(edited).getByRole("button", { name: "Leeren" }));
    await waitFor(() =>
      expect(cellFor("latour2005reassembling", "Fragestellung")).toHaveAttribute(
        "data-status",
        "empty",
      ),
    );
  });

  it("keeps hand-edited cells when all cells are refilled", async () => {
    const user = userEvent.setup();
    await withMatrix();
    const cell = cellFor("luhmann1984soziale", "Fragestellung");
    await user.click(within(cell).getByRole("button", { name: "Von Hand schreiben" }));
    await user.type(screen.getByRole("textbox", { name: /^Antwort/ }), "Eigene Antwort");
    await user.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() =>
      expect(cellFor("luhmann1984soziale", "Fragestellung")).toHaveAttribute(
        "data-status",
        "edited",
      ),
    );
    await user.click(screen.getByRole("button", { name: "Offene Zellen füllen" }));
    await waitFor(() =>
      expect(cellFor("luhmann1984soziale", "Methode")).toHaveAttribute("data-status", "filled"),
    );
    expect(
      within(cellFor("luhmann1984soziale", "Fragestellung")).getByText("Eigene Antwort"),
    ).toBeVisible();
  });

  it("renames, adds and removes columns and rows", async () => {
    const user = userEvent.setup();
    await withMatrix();
    await user.click(screen.getByRole("button", { name: "Spalte bearbeiten: Methode" }));
    const name = screen.getByRole("textbox", { name: "Name der Spalte" });
    await user.clear(name);
    await user.type(name, "Vorgehen");
    await user.click(screen.getByRole("button", { name: "Speichern" }));
    expect(await screen.findByRole("columnheader", { name: /Vorgehen/ })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Spalte" }));
    await user.type(screen.getByRole("textbox", { name: "Name der Spalte" }), "Ergebnis");
    await user.click(screen.getByRole("button", { name: "Speichern" }));
    expect(await screen.findByRole("columnheader", { name: /Ergebnis/ })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Spalte bearbeiten: Ergebnis" }));
    await user.click(screen.getByRole("button", { name: "Spalte entfernen" }));
    await waitFor(() =>
      expect(screen.queryByRole("columnheader", { name: /Ergebnis/ })).not.toBeInTheDocument(),
    );

    await user.click(
      screen.getByRole("button", { name: /^Zeile entfernen: Reassembling the Social/ }),
    );
    await waitFor(() => expect(screen.getAllByTestId("matrix-row")).toHaveLength(1));

    await user.click(screen.getByRole("combobox", { name: "Quelle hinzufügen" }));
    await user.click(
      await screen.findByRole("option", { name: /Theorie des kommunikativen Handelns/ }),
    );
    await waitFor(() => expect(screen.getAllByTestId("matrix-row")).toHaveLength(2));
  });
});

describe("export", () => {
  it("exports a Markdown table", async () => {
    const user = userEvent.setup();
    const { calls } = await withMatrix();
    await user.click(screen.getByRole("button", { name: "Offene Zellen füllen" }));
    await waitFor(() =>
      expect(cellFor("luhmann1984soziale", "Methode")).toHaveAttribute("data-status", "filled"),
    );
    await user.click(
      screen.getByRole("button", { name: "Matrix als Markdown-Tabelle exportieren" }),
    );
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(calls.find((c) => c.name === "matrix.export")?.input).toMatchObject({
      format: "markdown",
    });
    expect(saved[0]?.name).toMatch(/\.md$/);
    expect(saved[0]?.text).toMatch(
      /^\| Quelle \| Fragestellung \| Methode \|\n\| --- \| --- \| --- \|\n/,
    );
    expect(saved[0]?.text).toContain("| Luhmann 1984 |");
  });

  it("exports CSV", async () => {
    const user = userEvent.setup();
    await withMatrix();
    await user.click(screen.getByRole("button", { name: "Matrix als CSV exportieren" }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]?.name).toMatch(/\.csv$/);
    expect(saved[0]?.mime).toBe("text/csv");
    expect(saved[0]?.text.split("\n")[0]).toBe('"Quelle","Fragestellung","Methode"');
  });

  it("escapes pipes and quotes", () => {
    const data = createFixtures();
    const matrix = {
      id: "m_01J0000000AAAAAA",
      project: "phd-proposal",
      title: "t",
      created: { at: "2026-10-01T09:00:00.000Z", by: "human" as const },
      columns: [{ id: "mc_01J0000000AAAAAA", name: "A|B", instruction: "" }],
      rows: ["luhmann1984soziale"],
      cells: {
        luhmann1984soziale: {
          mc_01J0000000AAAAAA: {
            status: "edited" as const,
            answer: 'sagt "a|b"\nnoch',
            evidence: [],
          },
        },
      },
    };
    expect(exportMatrix(data, matrix, "markdown")).toContain("| A\\|B |");
    expect(exportMatrix(data, matrix, "markdown")).toContain('sagt "a\\|b" noch (Luhmann 1984)');
    expect(exportMatrix(data, matrix, "csv")).toContain('"sagt ""a|b""\nnoch (Luhmann 1984)"');
  });
});

describe("matrix list", () => {
  it("switches between matrices of a project", async () => {
    const user = userEvent.setup();
    const { core } = await withMatrix();
    await core.call(matrixCreate, {
      project: "phd-proposal",
      title: "Zweite Matrix",
      columns: [{ name: "Ergebnis", instruction: "" }],
      items: ["habermas1981theorie"],
    });
    await user.click(await screen.findByRole("combobox", { name: "Matrix" }));
    await user.click(await screen.findByRole("option", { name: "Zweite Matrix" }));
    expect(await screen.findByRole("columnheader", { name: /Ergebnis/ })).toBeVisible();
  });

  it("shows English strings", async () => {
    renderApp(TAB, undefined, { lang: "en" });
    expect(await screen.findByText("This project has no matrix yet")).toBeVisible();
  });
});
