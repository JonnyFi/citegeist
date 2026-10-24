import type { OpenDialogOptions } from "electron";

/** What the renderer sends over `citegeist:pick-paths`. It is untrusted input. */
export interface PickPathsRequest {
  kind?: unknown;
  multiple?: unknown;
  title?: unknown;
  extensions?: unknown;
}

/** Turns the renderer's request into the options of `dialog.showOpenDialog`. */
export function openDialogOptions(request: PickPathsRequest | null | undefined): OpenDialogOptions {
  const kind = request?.kind === "folder" || request?.kind === "any" ? request.kind : "file";
  const properties: NonNullable<OpenDialogOptions["properties"]> = [];
  if (kind === "file" || kind === "any") properties.push("openFile");
  if (kind === "folder" || kind === "any") properties.push("openDirectory");
  if (request?.multiple === true) properties.push("multiSelections");
  const options: OpenDialogOptions = { properties };
  if (typeof request?.title === "string") options.title = request.title.slice(0, 200);
  const extensions = Array.isArray(request?.extensions)
    ? request.extensions.filter(
        (e): e is string => typeof e === "string" && /^[A-Za-z0-9_-]+$/.test(e),
      )
    : [];
  if (extensions.length > 0 && kind === "file") {
    options.filters = [{ name: extensions.join(", "), extensions }];
  }
  return options;
}
