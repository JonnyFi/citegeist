import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderApp } from "../test-utils";

afterEach(() => {
  delete window.citegeist;
});

const addField = () => screen.findByRole("textbox", { name: "Hinzufügen" });
const file = (name: string) => new File(["x"], name);
const dropOf = (...files: File[]) => ({ dataTransfer: { types: ["Files"], files, items: [] } });
const addCalls = (calls: Array<{ name: string; input: unknown }>) =>
  calls.filter((c) => c.name === "items.add").map((c) => c.input);

/** Opens the drop area by focusing the field and returns the area. */
async function openDrop(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await addField());
  return screen.findByTestId("file-drop");
}

describe("add field drop area", () => {
  // protects=the library stays calm: the area is there when a person starts to add, not before
  // fails_when=the area is always shown, or never shows for the focused field or a dragged file
  // no_claim=nothing about where the area sits on screen
  it("opens under the field when it has focus or a file is dragged over the window", async () => {
    const user = userEvent.setup();
    renderApp("/");
    await addField();
    expect(screen.queryByTestId("file-drop")).toBeNull();

    await user.click(await addField());
    const zone = await screen.findByTestId("file-drop");
    expect(within(zone).getByText("PDF, EPUB oder HTML hierher ziehen oder")).toBeVisible();
    expect(within(zone).getByRole("button", { name: "Datei auswählen" })).toBeVisible();

    await user.click(document.body);
    await waitFor(() => expect(screen.queryByTestId("file-drop")).toBeNull());

    fireEvent.dragEnter(window, { dataTransfer: { types: ["Files"] } });
    expect(await screen.findByTestId("file-drop")).toBeVisible();
  });

  // protects=a PDF dropped on the area becomes a paper in the library without a typed path
  // fails_when=the drop is not sent to items.add, goes to the inbox, or no link to the paper shows
  // no_claim=nothing about the conversion of the PDF; the mock core stands in for the real one
  it("adds a dropped PDF to the library and links to it", async () => {
    const user = userEvent.setup();
    const { calls } = renderApp("/");
    const zone = await openDrop(user);
    fireEvent.drop(zone, dropOf(file("habermas.pdf")));

    expect(await screen.findByRole("link", { name: "pathhabermas" })).toBeVisible();
    expect(screen.getByText("Hinzugefügt:")).toBeVisible();
    expect(addCalls(calls)).toEqual([{ identifier: "habermas.pdf", target: "library" }]);
  });

  // protects=a file dropped beside the area does nothing, and the area closes with the drag
  // fails_when=a drop on the window adds the file, or the area stays open after the drop
  // no_claim=nothing about what the window does with the file in Electron; main cancels navigation
  it("ignores a drop outside the area", async () => {
    const { calls } = renderApp("/");
    await addField();
    fireEvent.dragEnter(window, dropOf(file("habermas.pdf")));
    await screen.findByTestId("file-drop");
    fireEvent.drop(window, dropOf(file("habermas.pdf")));

    await waitFor(() => expect(screen.queryByTestId("file-drop")).toBeNull());
    expect(addCalls(calls)).toEqual([]);
  });

  // protects=the area is lit while a file is over it
  // fails_when=the highlight is missing on the area of the add field
  // no_claim=nothing about the colors
  it("highlights while a file is over it", async () => {
    const user = userEvent.setup();
    renderApp("/");
    const zone = await openDrop(user);
    fireEvent.dragEnter(zone, { dataTransfer: { types: ["Files"] } });
    expect(zone).toHaveAttribute("data-over", "true");
  });

  // protects=several files at once give one row each and a summary that counts every outcome
  // fails_when=a file is lost, the duplicate counts as new, or the unsupported name is missing
  // no_claim=nothing about the order in which the core finishes the conversions
  it("adds several files and counts added, duplicate and unsupported", async () => {
    const user = userEvent.setup();
    const view = renderApp("/");
    const original = view.core.call.bind(view.core);
    view.core.call = ((contract, input) => {
      if (
        contract.name !== "items.add" ||
        (input as { identifier?: string }).identifier !== "dup.pdf"
      )
        return original(contract, input);
      view.calls.push({ name: contract.name, input });
      return Promise.resolve({
        citekey: "vaswani2017attention",
        job: "j_dup",
        duplicateOf: "vaswani2017attention",
      });
    }) as typeof view.core.call;
    const zone = await openDrop(user);
    fireEvent.drop(
      zone,
      dropOf(file("eins.pdf"), file("dup.pdf"), file("zwei.epub"), file("notizen.docx")),
    );

    const summary = await screen.findByText(
      "2 hinzugefügt, 1 schon vorhanden, 1 nicht unterstützt (notizen.docx)",
    );
    expect(summary).toBeVisible();
    expect(addCalls(view.calls)).toEqual([
      { identifier: "eins.pdf", target: "library" },
      { identifier: "dup.pdf", target: "library" },
      { identifier: "zwei.epub", target: "library" },
    ]);
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(4);
    expect(within(rows[0] as HTMLElement).getByRole("link", { name: "patheins" })).toBeVisible();
    expect(within(rows[1] as HTMLElement).getByText("Ist schon in der Bibliothek:")).toBeVisible();
    expect(within(rows[3] as HTMLElement).getByText("nicht unterstützt")).toBeVisible();
  });

  // protects=EPUB and HTML are taken like PDF, the types the core takes
  // fails_when=the list of types is narrower than the core's
  // no_claim=nothing about whether the core converts them well
  it("takes EPUB and HTML files", async () => {
    const user = userEvent.setup();
    const { calls } = renderApp("/");
    const zone = await openDrop(user);
    fireEvent.drop(zone, dropOf(file("buch.epub"), file("seite.html"), file("alt.HTM")));
    await waitFor(() => expect(addCalls(calls)).toHaveLength(3));
    expect(addCalls(calls).map((i) => (i as { identifier: string }).identifier)).toEqual([
      "buch.epub",
      "seite.html",
      "alt.HTM",
    ]);
  });

  // protects=a single unsupported file gets a message that names it and what is supported
  // fails_when=the file is sent to the core, or the message does not name it
  // no_claim=nothing about files with a wrong extension that are really PDFs
  it("says which file is not supported", async () => {
    const user = userEvent.setup();
    const { calls } = renderApp("/");
    const zone = await openDrop(user);
    fireEvent.drop(zone, dropOf(file("notizen.docx")));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "notizen.docx wird nicht unterstützt. citegeist nimmt PDF, EPUB und HTML.",
    );
    expect(addCalls(calls)).toEqual([]);
  });

  // protects=a failure of one file is reported for that file and does not stop the others
  // fails_when=the batch ends at the failing file, or the error is not shown
  // no_claim=nothing about retrying
  it("goes on with the next file when one fails", async () => {
    const user = userEvent.setup();
    const view = renderApp("/");
    const original = view.core.call.bind(view.core);
    view.core.call = ((contract, input) =>
      contract.name === "items.add" &&
      (input as { identifier?: string }).identifier === "kaputt.pdf"
        ? Promise.reject(new Error("PDF_UNREADABLE: kaputt"))
        : original(contract, input)) as typeof view.core.call;
    const zone = await openDrop(user);
    fireEvent.drop(zone, dropOf(file("kaputt.pdf"), file("heil.pdf")));
    expect(await screen.findByText("1 hinzugefügt, 1 fehlgeschlagen")).toBeVisible();
    expect(screen.getByText("PDF_UNREADABLE: kaputt")).toBeVisible();
  });

  // protects=files dropped while the library is filtered by a project carry that project
  // fails_when=a file of a batch loses the project
  // no_claim=nothing about files added without a filter
  it("files every dropped file under the project the library is filtered by", async () => {
    const user = userEvent.setup();
    const { calls } = renderApp("/?project=phd-proposal");
    const zone = await openDrop(user);
    fireEvent.drop(zone, dropOf(file("eins.pdf"), file("zwei.pdf")));
    await waitFor(() => expect(addCalls(calls)).toHaveLength(2));
    expect(addCalls(calls)).toEqual([
      { identifier: "eins.pdf", target: "library", projects: ["phd-proposal"] },
      { identifier: "zwei.pdf", target: "library", projects: ["phd-proposal"] },
    ]);
  });

  // protects=the desktop app sends the path of the file, not its name
  // fails_when=the name goes to items.add although the app can tell the path
  // no_claim=that the path exists on disk
  it("sends the path the desktop app reports for a dropped file", async () => {
    window.citegeist = {
      pathForFile: () => "/Users/alex/Papers/latour.pdf",
      onNavigate: () => () => {},
      platform: "test",
    } as never;
    const user = userEvent.setup();
    const { calls } = renderApp("/");
    const zone = await openDrop(user);
    fireEvent.drop(zone, dropOf(file("latour.pdf")));
    await waitFor(() =>
      expect(addCalls(calls)).toEqual([
        { identifier: "/Users/alex/Papers/latour.pdf", target: "library" },
      ]),
    );
  });

  // protects=the button of the area adds what the native dialog returns
  // fails_when=the button does nothing, or only one of several chosen files is added
  // no_claim=that the dialog filters by type; Electron does
  it("adds the files chosen with the button of the area", async () => {
    const pickPaths = vi.fn(async () => ["/Users/alex/a.pdf", "/Users/alex/b.epub"]);
    window.citegeist = { pickPaths, onNavigate: () => () => {}, platform: "test" } as never;
    const user = userEvent.setup();
    const { calls } = renderApp("/");
    const zone = await openDrop(user);
    await user.click(within(zone).getByRole("button", { name: "Datei auswählen" }));
    await waitFor(() => expect(addCalls(calls)).toHaveLength(2));
    expect(addCalls(calls)).toEqual([
      { identifier: "/Users/alex/a.pdf", target: "library" },
      { identifier: "/Users/alex/b.epub", target: "library" },
    ]);
    expect(await screen.findByText("2 hinzugefügt")).toBeVisible();
  });

  // protects=the browser preview chooses files with a file input that offers the core's types
  // fails_when=`accept` lacks EPUB or HTML, or the chosen file is not added
  // no_claim=nothing about the native dialog
  it("adds the files chosen with the file input in the browser", async () => {
    const user = userEvent.setup();
    const { calls } = renderApp("/");
    const zone = await openDrop(user);
    const input = within(zone).getByTestId("file-drop-input");
    expect(input).toHaveAttribute("accept", ".pdf,.epub,.html,.htm");
    await user.upload(input, [file("eins.pdf"), file("zwei.pdf")]);
    await waitFor(() => expect(addCalls(calls)).toHaveLength(2));
  });
});
