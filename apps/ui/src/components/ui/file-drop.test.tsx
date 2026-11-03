import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n";
import { CoreProvider } from "../../lib/hooks";
import { createMockCore } from "../../mock/core";
import { createFixtures } from "../../mock/fixtures";
import { FileDrop, type FileDropResult } from "./file-drop";

afterEach(() => {
  delete window.citegeist;
});

function setup(props: Partial<Parameters<typeof FileDrop>[0]> = {}) {
  const onFiles = vi.fn<(result: FileDropResult) => void>();
  const core = createMockCore(createFixtures("de"), { aiDelayMs: 50 });
  render(
    <I18nProvider lang="de">
      <QueryClientProvider client={new QueryClient()}>
        <CoreProvider core={core}>
          <FileDrop
            label="Dateien hierher ziehen oder"
            accept={[".pdf", ".epub"]}
            multiple
            onFiles={onFiles}
            {...props}
          />
        </CoreProvider>
      </QueryClientProvider>
    </I18nProvider>,
  );
  return { onFiles, zone: screen.getByTestId("file-drop") };
}

const file = (name: string) => new File(["x"], name);
const dropOf = (...files: File[]) => ({ dataTransfer: { types: ["Files"], files, items: [] } });

describe("FileDrop", () => {
  // protects=a dropped file reaches the caller with its name and path
  // fails_when=the drop is ignored, the path is lost or a file of an accepted type lands in `rejected`
  // no_claim=nothing about the native path of a real file; the browser preview uses the file name
  it("hands the dropped files to onFiles", () => {
    const { onFiles, zone } = setup();
    fireEvent.drop(zone, dropOf(file("a.pdf"), file("B.EPUB")));
    expect(onFiles).toHaveBeenCalledWith({
      files: [
        { name: "a.pdf", path: "a.pdf" },
        { name: "B.EPUB", path: "B.EPUB" },
      ],
      rejected: [],
      unreadable: [],
    });
  });

  // protects=the path the desktop app reads from a file wins over the name
  // fails_when=the name is used although pathForFile knows the real path
  // no_claim=that Electron's webUtils gives that path; the preload test covers the wiring
  it("uses the path the desktop app reports", () => {
    window.citegeist = {
      pathForFile: (f: File) => `/Users/alex/Papers/${f.name}`,
      onNavigate: () => () => {},
      platform: "test",
    } as never;
    const { onFiles, zone } = setup();
    fireEvent.drop(zone, dropOf(file("a.pdf")));
    expect(onFiles.mock.calls[0]?.[0].files).toEqual([
      { name: "a.pdf", path: "/Users/alex/Papers/a.pdf" },
    ]);
  });

  // protects=files of another type are named and not passed on
  // fails_when=a .docx reaches `files`, or the check is case sensitive
  // no_claim=nothing about what the core does with a file of an accepted type
  it("turns away files of another type and names them", () => {
    const { onFiles, zone } = setup();
    fireEvent.drop(zone, dropOf(file("a.PDF"), file("notizen.docx")));
    expect(onFiles.mock.calls[0]?.[0]).toMatchObject({
      files: [{ name: "a.PDF" }],
      rejected: ["notizen.docx"],
    });
  });

  // protects=a field for one file takes the first and no more
  // fails_when=several files reach a path field
  // no_claim=nothing about which file a person meant
  it("takes only the first file when it is not for several", () => {
    const { onFiles, zone } = setup({ multiple: false });
    fireEvent.drop(zone, dropOf(file("a.pdf"), file("b.pdf")));
    expect(onFiles.mock.calls[0]?.[0].files).toEqual([{ name: "a.pdf", path: "a.pdf" }]);
  });

  // protects=the area lights up while a file is over it and only then
  // fails_when=it stays lit after the file left or the drop, or lights up for dragged text
  // no_claim=nothing about the look of the highlight
  it("highlights while a file is dragged over it", () => {
    const { zone } = setup();
    fireEvent.dragEnter(zone, { dataTransfer: { types: ["text/plain"] } });
    expect(zone).not.toHaveAttribute("data-over");
    fireEvent.dragEnter(zone, { dataTransfer: { types: ["Files"] } });
    expect(zone).toHaveAttribute("data-over", "true");
    // leaving a child of the area does not end the drag
    fireEvent.dragEnter(zone, { dataTransfer: { types: ["Files"] } });
    fireEvent.dragLeave(zone, { dataTransfer: { types: ["Files"] } });
    expect(zone).toHaveAttribute("data-over", "true");
    fireEvent.dragLeave(zone, { dataTransfer: { types: ["Files"] } });
    expect(zone).not.toHaveAttribute("data-over");
    fireEvent.dragEnter(zone, { dataTransfer: { types: ["Files"] } });
    fireEvent.drop(zone, dropOf(file("a.pdf")));
    expect(zone).not.toHaveAttribute("data-over");
  });

  // protects=the file dialog of the browser preview offers the accepted types, several at once
  // fails_when=`accept` or `multiple` is missing on the input, or a chosen file is not passed on
  // no_claim=nothing about the native dialog of the desktop app
  it("chooses files with the file input in the browser", async () => {
    const user = userEvent.setup();
    const { onFiles } = setup();
    const input = screen.getByTestId("file-drop-input");
    expect(input).toHaveAttribute("accept", ".pdf,.epub");
    expect(input).toHaveAttribute("multiple");
    await user.upload(input, [file("a.pdf"), file("b.epub")]);
    expect(onFiles.mock.calls[0]?.[0].files.map((f) => f.name)).toEqual(["a.pdf", "b.epub"]);
  });

  // protects=the native dialog gets the extensions and its paths arrive as they are
  // fails_when=the dialog is opened without extensions, or its paths are lost
  // no_claim=that the dialog filters; Electron does that
  it("asks the native dialog in the desktop app", async () => {
    const user = userEvent.setup();
    const pickPaths = vi.fn(async () => ["/Users/alex/Papers/a.pdf", "/Users/alex/b.epub"]);
    window.citegeist = { pickPaths, onNavigate: () => () => {}, platform: "test" } as never;
    const { onFiles } = setup({ title: "Auswahl" });
    await user.click(screen.getByRole("button", { name: "Datei auswählen" }));
    expect(pickPaths).toHaveBeenCalledWith({
      kind: "file",
      multiple: true,
      extensions: ["pdf", "epub"],
      title: "Auswahl",
    });
    await vi.waitFor(() =>
      expect(onFiles).toHaveBeenCalledWith({
        files: [
          { name: "a.pdf", path: "/Users/alex/Papers/a.pdf" },
          { name: "b.epub", path: "/Users/alex/b.epub" },
        ],
        rejected: [],
        unreadable: [],
      }),
    );
  });

  // protects=a field for folders takes a dropped folder and turns a file away
  // fails_when=a file is taken as a folder, or a folder is turned away
  // no_claim=that the browser tells folders from files in every case; Electron's drop items do
  it("takes a folder where folders are wanted and no file", () => {
    const { onFiles, zone } = setup({ folders: true, multiple: false, accept: undefined });
    const folder = file("Papers");
    const items = [
      { kind: "file", getAsFile: () => folder, webkitGetAsEntry: () => ({ isDirectory: true }) },
    ];
    fireEvent.drop(zone, { dataTransfer: { types: ["Files"], files: [folder], items } });
    expect(onFiles.mock.calls[0]?.[0].files).toEqual([{ name: "Papers", path: "Papers" }]);
    fireEvent.drop(zone, dropOf(file("a.pdf")));
    expect(onFiles.mock.calls[1]?.[0]).toMatchObject({ files: [], rejected: ["a.pdf"] });
  });

  // protects=a field for folders has no file input, which cannot choose a folder
  // fails_when=a button appears that opens a dialog for files
  // no_claim=nothing about the native folder dialog
  it("offers no button for folders in the browser", () => {
    setup({ folders: true, accept: undefined });
    expect(screen.queryByRole("button")).toBeNull();
  });
});
