import { describe, expect, it } from "vitest";
import { openDialogOptions } from "./pick-paths.js";

describe("openDialogOptions", () => {
  it("defaults to a single file", () => {
    expect(openDialogOptions(undefined)).toEqual({ properties: ["openFile"] });
  });

  it("opens folders and allows several selections", () => {
    expect(openDialogOptions({ kind: "folder", multiple: true }).properties).toEqual([
      "openDirectory",
      "multiSelections",
    ]);
  });

  it("lets a person choose a file or a folder", () => {
    expect(openDialogOptions({ kind: "any" }).properties).toEqual(["openFile", "openDirectory"]);
  });

  it("filters files by extension and ignores malformed values", () => {
    const options = openDialogOptions({
      kind: "file",
      title: "Pick",
      extensions: ["pdf", "../x", 7],
    });
    expect(options.title).toBe("Pick");
    expect(options.filters).toEqual([{ name: "pdf", extensions: ["pdf"] }]);
  });

  it("does not filter folders", () => {
    expect(openDialogOptions({ kind: "folder", extensions: ["pdf"] }).filters).toBeUndefined();
  });
});
