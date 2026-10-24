import { pathToFileURL } from "node:url";

/**
 * Which pages may call the IPC handlers of the main process (M8). The handlers hand out the
 * token of the core and open file dialogs, so a page that is not the app's own renderer must not
 * reach them, even though the window loads nothing else today: a navigation or a frame inside
 * the window would otherwise inherit the preload bridge.
 */

/** The part of Electron's WebFrameMain the check reads. */
export interface SenderFrame {
  url: string;
  parent: unknown;
}

/**
 * Matches the URLs of the app's own renderer: the Vite dev server (same origin) or the one built
 * index.html on disk. The hash and the query do not matter, the quick-insert palette is
 * `index.html#/quick-insert`.
 */
export function ownRendererUrl(opts: {
  rendererUrl?: string | undefined;
  uiIndex: string;
}): (url: string) => boolean {
  const devOrigin = opts.rendererUrl ? new URL(opts.rendererUrl).origin : undefined;
  const indexPath = pathToFileURL(opts.uiIndex).pathname;
  return (url) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return false;
    }
    if (devOrigin) return parsed.origin === devOrigin;
    return parsed.protocol === "file:" && parsed.pathname === indexPath;
  };
}

/** True when the frame that sent a message is the top frame of the app's own renderer. */
export function isTrustedSender(
  frame: SenderFrame | null | undefined,
  isOwnUrl: (url: string) => boolean,
): boolean {
  if (!frame || frame.parent) return false;
  return isOwnUrl(frame.url);
}
