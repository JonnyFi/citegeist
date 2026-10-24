import {
  BrowserWindow,
  ClipboardItem,
  clipboard,
  globalShortcut,
  ipcMain,
  screen,
  shell,
  systemPreferences,
} from "electron";
import { isTrustedSender } from "../shared/trusted-sender.js";
import { QI } from "./channels.js";
import { type CitationPayload, QuickInsertController, type QuickInsertDeps } from "./controller.js";
import {
  checkAccelerator,
  loadQuickInsertSettings,
  type QuickInsertSettings,
  saveQuickInsertSettings,
} from "./settings.js";
import { macFrontApp, noFrontApp } from "./system.js";

export interface RegisterQuickInsertOptions {
  /** Electron's userData directory; the settings file lives there. */
  userDataDir: string;
  /** Built preload script of the palette (out/preload/quick-insert.cjs). */
  preload: string;
  /** Loads the renderer into the palette window: the UI with the hash `#/quick-insert`. */
  load(window: BrowserWindow): void | Promise<void>;
  /** True for URLs the palette may navigate to (its own page). Everything else is blocked. */
  isOwnUrl(url: string): boolean;
  /** Called when the hotkey could not be registered, so the app can tell the user. */
  onHotkeyError?(message: string): void;
}

export interface QuickInsertHandle {
  settings(): QuickInsertSettings;
  /** Applies and saves a change. Resolves with an error text when the hotkey is not usable. */
  update(patch: Partial<QuickInsertSettings>): Promise<{ ok: true } | { ok: false; error: string }>;
  dispose(): void;
}

const WIDTH = 700;
const HEIGHT = 500;

/**
 * Wires the quick-insert palette into the running Electron app: global hotkey, floating window,
 * clipboard and paste. Call once after `app.whenReady()`. See docs in the PR for what main.ts
 * has to pass.
 */
export function registerQuickInsert(opts: RegisterQuickInsertOptions): QuickInsertHandle {
  let settings = loadQuickInsertSettings(opts.userDataDir);
  let win: BrowserWindow | null = null;
  let loaded = false;

  const ensureWindow = (): BrowserWindow => {
    if (win && !win.isDestroyed()) return win;
    loaded = false;
    const created = new BrowserWindow({
      width: WIDTH,
      height: HEIGHT,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      resizable: false,
      fullscreenable: false,
      minimizable: false,
      maximizable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      // A non-activating panel: the app that had focus stays frontmost while the palette takes keys.
      ...(process.platform === "darwin" ? { type: "panel" as const } : {}),
      webPreferences: {
        preload: opts.preload,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });
    created.setAlwaysOnTop(true, "pop-up-menu");
    created.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    created.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//.test(url)) void shell.openExternal(url);
      return { action: "deny" };
    });
    created.webContents.on("will-navigate", (event, url) => {
      if (!opts.isOwnUrl(url)) event.preventDefault();
    });
    created.webContents.on("did-finish-load", () => {
      loaded = true;
    });
    created.on("blur", () => controller.blurred());
    created.on("closed", () => {
      if (win === created) win = null;
    });
    void opts.load(created);
    win = created;
    return created;
  };

  const paletteWindow = {
    show() {
      const w = ensureWindow();
      const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
      w.setPosition(
        Math.round(area.x + (area.width - WIDTH) / 2),
        Math.round(area.y + area.height * 0.16),
      );
      w.show();
      w.focus();
    },
    hide() {
      if (win && !win.isDestroyed()) win.hide();
    },
    isVisible: () => Boolean(win && !win.isDestroyed() && win.isVisible()),
  };

  const deps: QuickInsertDeps = {
    shortcuts: {
      register: (accelerator, callback) => globalShortcut.register(accelerator, callback),
      unregister: (accelerator) => globalShortcut.unregister(accelerator),
    },
    window: paletteWindow,
    notifyShown() {
      if (win && !win.isDestroyed() && loaded) win.webContents.send(QI.show);
    },
    clipboard: {
      // HTML and plain text in one entry: a word processor pastes the formatted version, a code editor the plain one (D2).
      write: ({ html, text }) =>
        clipboard.write([
          new ClipboardItem({ "text/plain": text, ...(html ? { "text/html": html } : {}) }),
        ]),
    },
    front: process.platform === "darwin" ? macFrontApp() : noFrontApp,
    accessibility: {
      isTrusted: () =>
        process.platform === "darwin" && systemPreferences.isTrustedAccessibilityClient(false),
      prompt: () => {
        if (process.platform === "darwin") systemPreferences.isTrustedAccessibilityClient(true);
      },
    },
    delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
  const controller = new QuickInsertController(deps);

  // Only the palette window may drive the palette.
  const fromPalette = (sender: Electron.WebContents) =>
    Boolean(win && !win.isDestroyed() && sender === win.webContents);
  // Every handler answers the app's own renderer only (M8): the palette and the settings page.
  const fromOwnPage = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) =>
    isTrustedSender(event.senderFrame, opts.isOwnUrl);

  ipcMain.handle(QI.deliver, async (event, payload: unknown) => {
    if (!fromPalette(event.sender) || !fromOwnPage(event)) throw new Error("not the palette");
    const p = payload as Partial<CitationPayload> | null;
    if (!p || typeof p.text !== "string" || p.text.length > 1_000_000) {
      throw new Error("invalid citation payload");
    }
    const html = typeof p.html === "string" && p.html.length <= 1_000_000 ? p.html : undefined;
    return controller.deliver({ text: p.text, html });
  });
  ipcMain.on(QI.close, (event) => {
    if (fromPalette(event.sender) && fromOwnPage(event)) void controller.close();
  });
  ipcMain.on(QI.requestAccessibility, (event) => {
    if (fromPalette(event.sender) && fromOwnPage(event)) controller.requestAccessibility();
  });
  ipcMain.on(QI.hotkey, (event) => {
    event.returnValue = fromOwnPage(event) ? settings.accelerator : "";
  });
  ipcMain.handle(QI.getSettings, (event) => {
    if (!fromOwnPage(event)) throw new Error("not the app's renderer");
    return settings;
  });
  ipcMain.handle(QI.setSettings, (event, patch: unknown) => {
    if (!fromOwnPage(event)) throw new Error("not the app's renderer");
    return update(patch as Partial<QuickInsertSettings>);
  });

  const apply = (next: QuickInsertSettings) =>
    controller.setHotkey(next.enabled ? next.accelerator : undefined);

  async function update(patch: Partial<QuickInsertSettings>) {
    const next: QuickInsertSettings = { ...settings };
    if (typeof patch.enabled === "boolean") next.enabled = patch.enabled;
    if (typeof patch.accelerator === "string") {
      const checked = checkAccelerator(patch.accelerator);
      if (!checked.ok) return checked;
      next.accelerator = checked.accelerator;
    }
    const result = apply(next);
    if (!result.ok) return result;
    settings = next;
    await saveQuickInsertSettings(opts.userDataDir, settings);
    return { ok: true as const };
  }

  const first = apply(settings);
  if (!first.ok) opts.onHotkeyError?.(first.error);
  // Load the palette page in the background, so the first press opens it at once.
  const warm = setTimeout(() => ensureWindow(), 1500);

  return {
    settings: () => settings,
    update,
    dispose() {
      clearTimeout(warm);
      controller.dispose();
      for (const channel of [QI.deliver, QI.getSettings, QI.setSettings])
        ipcMain.removeHandler(channel);
      for (const channel of [QI.close, QI.requestAccessibility, QI.hotkey])
        ipcMain.removeAllListeners(channel);
      if (win && !win.isDestroyed()) win.destroy();
      win = null;
    },
  };
}
