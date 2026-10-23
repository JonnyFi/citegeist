/**
 * Puts a citation on the clipboard as HTML and plain text together, so a word processor pastes the
 * formatted version and a code editor the plain one (D2). Falls back to plain text alone.
 */
export async function copyRich(payload: {
  html?: string | undefined;
  text: string;
}): Promise<void> {
  const clipboard = navigator.clipboard;
  if (payload.html && typeof ClipboardItem !== "undefined" && clipboard.write) {
    await clipboard.write([
      new ClipboardItem({
        "text/html": new Blob([payload.html], { type: "text/html" }),
        "text/plain": new Blob([payload.text], { type: "text/plain" }),
      }),
    ]);
    return;
  }
  await clipboard.writeText(payload.text);
}

/** Saves text as a file through a temporary link, for the project exports. */
export function downloadText(filename: string, mime: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
