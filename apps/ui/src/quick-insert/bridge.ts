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
 * A Pandoc snippet for the text that is open in the main window of citegeist. The main process
 * hands it to the main window and leaves the clipboard alone.
 */
export interface EditorPayload {
  kind: "editor";
  text: string;
}

/**
 * Where a citation goes, decided by the main process when the palette opens: into the open text
 * of citegeist itself (Pandoc syntax), or into whatever other app had focus (formatted text).
 */
export type PaletteTarget =
  | { type: "text"; project: string; text: string; lang?: string | undefined }
  | { type: "external" };

/**
 * Result of `deliver`. `pasted: true` means the citation arrived: pasted into the previously
 * focused app, or inserted into the open text, and the palette is hidden. Otherwise the citation
 * is on the clipboard only (or, for `editor-unavailable`, nowhere), and `reason` says why, so the
 * palette can tell the user.
 */
export type DeliverResult =
  | { pasted: true }
  | { pasted: false; reason: "no-permission" | "unsupported" | "editor-unavailable" };

/**
 * The contract between the palette window's preload script and the palette. Like `CitegeistBridge`,
 * the renderer never imports Electron. In a plain browser `window.citegeistQuickInsert` is
 * undefined.
 */
export interface QuickInsertBridge {
  /** Where to reach the core. Read on every show, because a library switch changes port and token. */
  connection(): QuickInsertConnection | null;
  /**
   * With a CitationPayload: writes the clipboard (HTML and text) and, with Accessibility
   * permission, pastes into the previous app. With an EditorPayload: inserts into the open text of
   * the main window, without clipboard and without a keystroke.
   */
  deliver(payload: CitationPayload | EditorPayload): Promise<DeliverResult>;
  /** Hides the palette and gives focus back to the app that had it. */
  close(): void;
  /** Opens the macOS prompt for the Accessibility permission. */
  requestAccessibility(): void;
  /** Where a citation goes right now. Read at mount, for a palette that is shown before it listens. */
  target(): PaletteTarget;
  /** Called each time the palette is shown (hotkey), with the target, so it can clear the search and focus the field. */
  onShow(listener: (target: PaletteTarget) => void): () => void;
  /** The accelerator that opens the palette, for the hint line. */
  hotkey(): string;
  platform: string;
}

declare global {
  interface Window {
    citegeistQuickInsert?: QuickInsertBridge;
  }
}
