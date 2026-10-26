/**
 * Same shape as `CoreConnection` in ../bridge. Repeated here so that this file has no imports and
 * the desktop preload can type itself against it without pulling in more of the UI.
 */
export interface QuickInsertConnection {
  url: string;
  wsUrl: string;
  token: string;
  library: string;
}

/** What the palette hands to the main process: a citation as HTML plus plain text. */
export interface CitationPayload {
  html?: string | undefined;
  text: string;
}

/**
 * Result of `deliver`. `pasted: true` means the main process already pasted into the previously
 * focused app and hid the palette. Otherwise the citation is on the clipboard only, and `reason`
 * says why, so the palette can tell the user.
 */
export type DeliverResult =
  | { pasted: true }
  | { pasted: false; reason: "no-permission" | "unsupported" };

/**
 * The contract between the palette window's preload script and the palette. Like `CitegeistBridge`,
 * the renderer never imports Electron. In a plain browser `window.citegeistQuickInsert` is
 * undefined.
 */
export interface QuickInsertBridge {
  /** Where to reach the core. Read on every show, because a library switch changes port and token. */
  connection(): QuickInsertConnection | null;
  /** Writes the clipboard (HTML and text) and, with Accessibility permission, pastes into the previous app. */
  deliver(payload: CitationPayload): Promise<DeliverResult>;
  /** Hides the palette and gives focus back to the app that had it. */
  close(): void;
  /** Opens the macOS prompt for the Accessibility permission. */
  requestAccessibility(): void;
  /** Called each time the palette is shown (hotkey), so it can clear the search and focus the field. */
  onShow(listener: () => void): () => void;
  /** The accelerator that opens the palette, for the hint line. */
  hotkey(): string;
  platform: string;
}

declare global {
  interface Window {
    citegeistQuickInsert?: QuickInsertBridge;
  }
}
