/**
 * The contract between the Electron preload script and the renderer. The renderer never imports
 * Electron; in a plain browser `window.citegeist` is undefined and the UI falls back to the mock core.
 */

/** Where the renderer reaches the core. Token and port change on every core start. */
export interface CoreConnection {
  /** Base URL of the oRPC endpoint, e.g. http://127.0.0.1:51234 */
  url: string;
  /** WebSocket URL for change events, token included. */
  wsUrl: string;
  token: string;
  /** Absolute path of the open library. */
  library: string;
}

/** Settings of the quick-insert palette, which lives in the main process. */
export interface QuickInsertSettings {
  enabled: boolean;
  /** Electron accelerator, e.g. "CommandOrControl+Shift+K". */
  accelerator: string;
}

export interface QuickInsertSettingsBridge {
  get(): Promise<QuickInsertSettings>;
  /** Applies and saves a change. The error says why a hotkey was refused. */
  set(patch: Partial<QuickInsertSettings>): Promise<{ ok: true } | { ok: false; error: string }>;
}

export interface CitegeistBridge {
  /** Null until a library is open. */
  connection: CoreConnection | null;
  /** Opens the native folder picker and switches to that library. Resolves false when cancelled. */
  openLibrary(): Promise<boolean>;
  /** Native picker to create a new library in an empty folder. Resolves false when cancelled. */
  createLibrary(): Promise<boolean>;
  /** Subscribes to navigation requests from the menu and from citegeist:// links. */
  onNavigate(listener: (path: string) => void): () => void;
  /** Settings of the quick-insert palette. Absent where there is no palette. */
  quickInsert?: QuickInsertSettingsBridge;
  /**
   * Absolute path of a file dropped onto the window (Electron's `webUtils.getPathForFile`). The
   * renderer cannot read it from the `File`; items.add takes the path.
   */
  pathForFile?(file: File): string;
  platform: string;
}

declare global {
  interface Window {
    citegeist?: CitegeistBridge;
  }
}
