import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pollConfig } from "../onboarding/parts";
import { renderApp } from "../test-utils";

beforeEach(() => {
  pollConfig.ms = 5;
});
afterEach(() => localStorage.clear());

const preview = () => screen.getByRole("button", { name: "Vorschau" });
const run = () => screen.getByRole("button", { name: "Importieren" });

async function fillFile(user: ReturnType<typeof userEvent.setup>, kind: string, path: string) {
  await user.click(await screen.findByRole("button", { name: kind }));
  await user.type(screen.getByLabelText("Pfad zur Datei"), path);
}

describe("import screen", () => {
  it("opens from the navigation", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await user.click(await screen.findByRole("link", { name: "Import" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Import" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Import" })).toHaveAttribute("aria-current", "page");
  });

  it("opens by address in English", async () => {
    renderApp("/import", undefined, { lang: "en" });
    expect(await screen.findByRole("button", { name: "Preview" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Import" })).toBeDisabled();
  });

  it("offers Zotero as a database copy or a running instance, and three file formats", async () => {
    const user = userEvent.setup();
    renderApp("/import");
    expect(await screen.findByRole("button", { name: "Zotero (Datenbank-Kopie)" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByLabelText("Pfad zu zotero.sqlite oder zum Zotero-Ordner")).toBeVisible();
    expect(screen.getByLabelText("Ordner mit den Anhängen (optional)")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Zotero (läuft gerade)" }));
    expect(screen.getByLabelText("Port der lokalen API")).toHaveValue("23119");
    expect(screen.queryByLabelText("Pfad zur Datei")).toBeNull();

    await user.click(screen.getByRole("button", { name: "RIS" }));
    expect(screen.getByLabelText("Pfad zur Datei")).toBeVisible();
    expect(screen.getByLabelText("Ordner mit PDFs (optional)")).toBeVisible();
    expect(screen.queryByText("Sammlungen werden zu")).toBeNull();
  });

  it("needs a path before it previews and a preview before it imports", async () => {
    const user = userEvent.setup();
    renderApp("/import");
    await screen.findByRole("heading", { level: 1, name: "Import" });
    expect(preview()).toBeDisabled();
    expect(run()).toBeDisabled();
    await user.type(
      screen.getByLabelText("Pfad zu zotero.sqlite oder zum Zotero-Ordner"),
      "/Users/me/Zotero",
    );
    expect(preview()).toBeEnabled();
    expect(run()).toBeDisabled();
    expect(screen.getByText("Prüfe zuerst die Vorschau mit diesen Einstellungen.")).toBeVisible();
  });

  // protects=the native dialog fills the path field and is asked for the right kind of thing
  // fails_when=the dialog gets other extensions than the format needs, a folder field asks for files, or the path is lost
  // no_claim=that Electron filters what the dialog shows
  it("fills the path from the native picker and keeps typed paths in the browser", async () => {
    const user = userEvent.setup();
    const pickPaths = vi.fn(async () => ["/Users/me/lit.bib"]);
    window.citegeist = { pickPaths, onNavigate: () => () => {}, platform: "test" } as never;
    try {
      renderApp("/import");
      await user.click(await screen.findByRole("button", { name: "BibTeX" }));
      await user.click(screen.getByRole("button", { name: "Datei auswählen: Pfad zur Datei" }));
      expect(pickPaths).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "file", extensions: ["bib", "bibtex"] }),
      );
      await waitFor(() =>
        expect(screen.getByLabelText("Pfad zur Datei")).toHaveValue("/Users/me/lit.bib"),
      );
      await user.click(
        screen.getByRole("button", { name: "Ordner auswählen: Ordner mit PDFs (optional)" }),
      );
      expect(pickPaths).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "folder" }));
    } finally {
      delete window.citegeist;
    }
  });

  // protects=every path field shows a drop area, and in the browser a file button where files are meant
  // fails_when=a file field has no area or button, or the folder field offers a file input that cannot choose a folder
  // no_claim=nothing about the native folder dialog
  it("shows a drop area at each path field and a file button where files are meant", async () => {
    const user = userEvent.setup();
    renderApp("/import");
    await screen.findByLabelText("Pfad zu zotero.sqlite oder zum Zotero-Ordner");
    expect(screen.getAllByTestId("file-drop")).toHaveLength(2);
    expect(
      screen.getByRole("button", {
        name: "Auswählen: Pfad zu zotero.sqlite oder zum Zotero-Ordner",
      }),
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: /^Ordner auswählen/ })).toBeNull();

    await user.click(screen.getByRole("button", { name: "RIS" }));
    expect(screen.getAllByTestId("file-drop")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Datei auswählen: Pfad zur Datei" })).toBeVisible();
    expect(screen.queryByRole("button", { name: /Ordner mit PDFs/ })).toBeNull();
  });

  // protects=a file dropped on the area of a format fills the path field and the preview then reads it
  // fails_when=the drop does not fill the field, fills it with the name instead of the path, or the preview ignores it
  // no_claim=that the file is a valid BibTeX file; the preview of the core decides
  it("fills the path field from a dropped file and previews it", async () => {
    window.citegeist = {
      pathForFile: (f: File) => `/Users/me/${f.name}`,
      onNavigate: () => () => {},
      platform: "test",
    } as never;
    try {
      const user = userEvent.setup();
      const { calls } = renderApp("/import");
      await user.click(await screen.findByRole("button", { name: "BibTeX" }));
      const zone = screen.getByRole("region", { name: "Datei hierher ziehen oder" });
      fireEvent.drop(zone, {
        dataTransfer: { types: ["Files"], files: [new File(["@book{}"], "lit.bib")], items: [] },
      });
      await waitFor(() =>
        expect(screen.getByLabelText("Pfad zur Datei")).toHaveValue("/Users/me/lit.bib"),
      );
      await user.click(preview());
      expect(await screen.findByTestId("import-report")).toBeVisible();
      expect(calls.find((c) => c.name === "import.preview")?.input).toMatchObject({
        source: { kind: "bibtex", path: "/Users/me/lit.bib" },
      });
    } finally {
      delete window.citegeist;
    }
  });

  // protects=a file picked with the file input of the browser preview fills the path field
  // fails_when=the input offers other extensions than the format, or the chosen name is lost
  // no_claim=nothing about the native dialog
  it("fills the path field from the file input in the browser", async () => {
    const user = userEvent.setup();
    renderApp("/import");
    await user.click(await screen.findByRole("button", { name: "RIS" }));
    const input = screen.getByTestId("file-drop-input");
    expect(input).toHaveAttribute("accept", ".ris");
    await user.upload(input, new File(["TY  - BOOK"], "lit.ris"));
    await waitFor(() => expect(screen.getByLabelText("Pfad zur Datei")).toHaveValue("lit.ris"));
  });

  // protects=a file of the wrong format is named and does not replace the path
  // fails_when=a .docx fills a BibTeX field, or no message says why nothing happened
  // no_claim=nothing about files with the right extension and wrong content
  it("names a dropped file of the wrong format and keeps the path", async () => {
    const user = userEvent.setup();
    renderApp("/import");
    await fillFile(user, "BibTeX", "/Users/me/lit.bib");
    const zone = screen.getByRole("region", { name: "Datei hierher ziehen oder" });
    fireEvent.drop(zone, {
      dataTransfer: { types: ["Files"], files: [new File(["x"], "notizen.docx")], items: [] },
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "notizen.docx passt hier nicht. Erwartet wird .bib, .bibtex.",
    );
    expect(screen.getByLabelText("Pfad zur Datei")).toHaveValue("/Users/me/lit.bib");
  });

  // protects=a dropped folder fills the folder field and a dropped file does not
  // fails_when=a PDF file is taken for the PDF folder, or a folder is turned away
  // no_claim=that Electron's drop items mark every folder
  it("takes a dropped folder for the PDF folder and turns a file away", async () => {
    window.citegeist = {
      pathForFile: (f: File) => `/Users/me/${f.name}`,
      onNavigate: () => () => {},
      platform: "test",
    } as never;
    try {
      const user = userEvent.setup();
      renderApp("/import");
      await user.click(await screen.findByRole("button", { name: "BibTeX" }));
      const zone = screen.getByRole("region", { name: "Ordner hierher ziehen oder" });
      const folder = new File([], "pdfs");
      fireEvent.drop(zone, {
        dataTransfer: {
          types: ["Files"],
          files: [folder],
          items: [
            {
              kind: "file",
              getAsFile: () => folder,
              webkitGetAsEntry: () => ({ isDirectory: true }),
            },
          ],
        },
      });
      await waitFor(() =>
        expect(screen.getByLabelText("Ordner mit PDFs (optional)")).toHaveValue("/Users/me/pdfs"),
      );
      fireEvent.drop(zone, {
        dataTransfer: { types: ["Files"], files: [new File(["x"], "a.pdf")], items: [] },
      });
      expect(await screen.findByText("a.pdf ist kein Ordner.")).toBeVisible();
      expect(screen.getByLabelText("Ordner mit PDFs (optional)")).toHaveValue("/Users/me/pdfs");
    } finally {
      delete window.citegeist;
    }
  });

  it("previews a BibTeX file with a PDF folder: counts, duplicates and problems", async () => {
    const user = userEvent.setup();
    const { calls } = renderApp("/import");
    await fillFile(user, "BibTeX", "/Users/me/lit.bib");
    await user.type(screen.getByLabelText("Ordner mit PDFs (optional)"), "/Users/me/pdfs");
    await user.click(preview());

    const report = await screen.findByTestId("import-report");
    expect(calls.find((c) => c.name === "import.preview")?.input).toEqual({
      onDuplicate: "skip",
      attachments: true,
      source: { kind: "bibtex", path: "/Users/me/lit.bib", pdfFolder: "/Users/me/pdfs" },
    });
    expect(within(report).getByText("/Users/me/lit.bib")).toBeVisible();
    expect(within(report).getByTestId("count-items")).toHaveTextContent("41");
    expect(within(report).getByTestId("count-create")).toHaveTextContent("39");
    expect(within(report).getByTestId("count-skip")).toHaveTextContent("2");
    expect(within(report).getByTestId("count-attachments")).toHaveTextContent("18");
    expect(within(report).getByRole("heading", { name: "Dubletten (2)" })).toBeVisible();
    expect(within(report).getByTestId("duplicate")).toHaveTextContent("gleicht luhmann1984soziale");
    expect(within(report).getByTestId("duplicate")).toHaveTextContent("DOI");
    expect(within(report).getByRole("heading", { name: "Probleme (14)" })).toBeVisible();
    expect(within(report).getAllByTestId("problem")).toHaveLength(2);
    expect(
      within(report).getByText("12 weitere Probleme sind hier nicht aufgeführt."),
    ).toBeVisible();
    expect(
      within(report).getByText(
        "Die Liste zeigt nur die ersten Einträge. Die Zahlen oben sind vollständig.",
      ),
    ).toBeVisible();
    expect(run()).toBeEnabled();
  });

  it("sends the Zotero options and counts new projects when collections become projects", async () => {
    const user = userEvent.setup();
    const { calls } = renderApp("/import");
    await user.type(
      await screen.findByLabelText("Pfad zu zotero.sqlite oder zum Zotero-Ordner"),
      "/Users/me/Zotero/zotero.sqlite",
    );
    await user.click(screen.getByRole("button", { name: "Projekten" }));
    await user.click(screen.getByRole("button", { name: "Zusammenführen" }));
    await user.click(screen.getByRole("checkbox", { name: "Notizen übernehmen" }));
    await user.click(preview());
    const report = await screen.findByTestId("import-report");
    expect(within(report).getByTestId("count-projects")).toHaveTextContent("9");
    expect(within(report).getByTestId("count-merge")).toHaveTextContent("6");
    expect(within(report).getByTestId("count-notes")).toHaveTextContent("0");
    expect(calls.find((c) => c.name === "import.preview")?.input).toEqual({
      collections: "projects",
      onDuplicate: "merge",
      attachments: true,
      notes: false,
      annotations: true,
      automaticTags: true,
      source: { kind: "zotero-sqlite", path: "/Users/me/Zotero/zotero.sqlite" },
    });
  });

  it("turns off annotations together with attachments", async () => {
    const user = userEvent.setup();
    renderApp("/import");
    const annotations = await screen.findByRole("checkbox", {
      name: "PDF-Markierungen als Karten übernehmen",
    });
    expect(annotations).toBeChecked();
    await user.click(screen.getByRole("checkbox", { name: "Anhänge übernehmen" }));
    expect(annotations).toBeDisabled();
    expect(annotations).not.toBeChecked();
  });

  it("previews through the running Zotero and refuses a bad port", async () => {
    const user = userEvent.setup();
    const { calls } = renderApp("/import");
    await user.click(await screen.findByRole("button", { name: "Zotero (läuft gerade)" }));
    const port = screen.getByLabelText("Port der lokalen API");
    await user.clear(port);
    await user.type(port, "80");
    expect(screen.getByText("Der Port muss zwischen 1024 und 65535 liegen.")).toBeVisible();
    expect(preview()).toBeDisabled();

    await user.clear(port);
    await user.type(port, "4000");
    await user.click(preview());
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Zotero does not answer on port 4000",
    );

    await user.clear(port);
    await user.type(port, "23119");
    await user.click(preview());
    expect(await screen.findByTestId("import-report")).toBeVisible();
    expect(calls.filter((c) => c.name === "import.preview").map((c) => c.input)).toContainEqual(
      expect.objectContaining({ source: { kind: "zotero-api", port: 23119 } }),
    );
  });

  it("shows an unreadable source as an error and writes nothing", async () => {
    const user = userEvent.setup();
    const { calls } = renderApp("/import");
    await fillFile(user, "CSL-JSON", "/missing/library.json");
    await user.click(preview());
    expect(await screen.findByRole("alert")).toHaveTextContent("There is no file at");
    expect(screen.queryByTestId("import-report")).toBeNull();
    expect(run()).toBeDisabled();
    expect(calls.some((c) => c.name === "import.run")).toBe(false);
  });

  it("drops the preview when the settings change, so a run always matches what was checked", async () => {
    const user = userEvent.setup();
    renderApp("/import");
    await fillFile(user, "RIS", "/Users/me/lit.ris");
    await user.click(preview());
    await screen.findByTestId("import-report");
    expect(run()).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Zusammenführen" }));
    expect(screen.queryByTestId("import-report")).toBeNull();
    expect(run()).toBeDisabled();
  });

  it("runs the import as a job and ends with a result summary", async () => {
    const user = userEvent.setup();
    pollConfig.ms = 60;
    const { calls } = renderApp("/import");
    await fillFile(user, "BibTeX", "/Users/me/lit.bib");
    await user.click(preview());
    await screen.findByTestId("import-report");
    await user.click(run());

    const progress = await screen.findByTestId("import-progress");
    expect(within(progress).getByRole("progressbar", { name: "Der Import läuft" })).toBeVisible();
    expect(run()).toBeDisabled();

    const result = await screen.findByTestId("import-result", undefined, { timeout: 3000 });
    expect(screen.getByRole("heading", { name: "Import abgeschlossen" })).toBeVisible();
    expect(within(result).getByTestId("count-created")).toHaveTextContent("6");
    expect(within(result).getByTestId("count-skipped")).toHaveTextContent("2");
    expect(within(result).getByTestId("count-merged")).toHaveTextContent("0");
    expect(within(result).getAllByTestId("problem")).toHaveLength(2);
    expect(screen.getByRole("link", { name: "Bibliothek öffnen" })).toBeVisible();
    expect(screen.queryByTestId("import-report")).toBeNull();
    expect(calls.find((c) => c.name === "import.run")?.input).toEqual(
      calls.find((c) => c.name === "import.preview")?.input,
    );

    await user.click(screen.getByRole("button", { name: "Weiteren Import starten" }));
    expect(screen.queryByTestId("import-result")).toBeNull();
    await waitFor(() => expect(run()).toBeDisabled());
  });
});
