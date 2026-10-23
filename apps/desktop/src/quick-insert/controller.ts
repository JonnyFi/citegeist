import type { FrontApp } from "./system.js";

export interface CitationPayload {
  html?: string | undefined;
  text: string;
}

export type DeliverResult =
  | { pasted: true }
  | { pasted: false; reason: "no-permission" | "unsupported" };

/** The palette window, as far as the controller cares. */
export interface PaletteWindow {
  /** Positions the window and shows it with keyboard focus. */
  show(): void;
  hide(): void;
  isVisible(): boolean;
}

export interface QuickInsertDeps {
  shortcuts: {
    register(accelerator: string, callback: () => void): boolean;
    unregister(accelerator: string): void;
  };
  window: PaletteWindow;
  /** Tells the palette it was shown, so it can reset. */
  notifyShown(): void;
  clipboard: { write(data: { html?: string; text: string }): Promise<void> | void };
  front: FrontApp;
  accessibility: { isTrusted(): boolean; prompt(): void };
  delay(ms: number): Promise<void>;
  /** Bundle id of this app, so a palette opened over citegeist itself does not "restore" anything odd. */
  ownBundleId?: string;
}

export type HotkeyResult = { ok: true } | { ok: false; error: string };

/** Pause between giving focus back and typing Cmd+V, so the keystroke lands in the right app. */
export const FOCUS_SETTLE_MS = 150;

/**
 * Logic of the quick-insert palette, free of Electron so it can be tested. The Electron wiring
 * (window, globalShortcut, clipboard, systemPreferences) lives in electron.ts.
 *
 * Flow: the hotkey remembers the frontmost app, shows the palette and tells it so. `deliver`
 * puts the citation on the clipboard and, when allowed, hides the palette, activates the
 * remembered app and types Cmd+V. `close` hides the palette and activates the remembered app.
 */
export class QuickInsertController {
  private accelerator: string | undefined;
  private previous: string | undefined;
  private opening = false;
  private delivering = false;

  constructor(private readonly deps: QuickInsertDeps) {}

  /** Registers the hotkey. Fails with a readable error when another app owns it. */
  setHotkey(accelerator: string | undefined): HotkeyResult {
    const old = this.accelerator;
    if (accelerator === old) return { ok: true };
    if (accelerator !== undefined) {
      let registered = false;
      try {
        registered = this.deps.shortcuts.register(accelerator, () => void this.toggle());
      } catch {
        return { ok: false, error: `"${accelerator}" is not a valid hotkey.` };
      }
      if (!registered) {
        return {
          ok: false,
          error: `${accelerator} is taken by another app or by macOS. Choose another hotkey.`,
        };
      }
    }
    if (old !== undefined) this.deps.shortcuts.unregister(old);
    this.accelerator = accelerator;
    return { ok: true };
  }

  get hotkey(): string | undefined {
    return this.accelerator;
  }

  /** Hotkey pressed: opens the palette, or closes it when it is already open. */
  async toggle(): Promise<void> {
    if (this.deps.window.isVisible()) return this.close();
    await this.open();
  }

  async open(): Promise<void> {
    if (this.opening || this.deps.window.isVisible()) return;
    this.opening = true;
    try {
      // Before the window takes focus, or the frontmost app would be citegeist.
      this.previous = await this.deps.front.capture();
      this.deps.window.show();
      this.deps.notifyShown();
    } finally {
      this.opening = false;
    }
  }

  /** Escape: hide and give focus back to where it was. */
  async close(): Promise<void> {
    const wasVisible = this.deps.window.isVisible();
    this.deps.window.hide();
    if (wasVisible) await this.restoreFocus();
  }

  /** The palette lost focus because the user clicked elsewhere: hide it, leave focus alone. */
  blurred(): void {
    if (this.deps.window.isVisible() && !this.delivering) this.deps.window.hide();
  }

  async deliver(payload: CitationPayload): Promise<DeliverResult> {
    await this.deps.clipboard.write({
      text: payload.text,
      ...(payload.html ? { html: payload.html } : {}),
    });
    if (!this.deps.front.supportsPaste) return { pasted: false, reason: "unsupported" };
    if (!this.deps.accessibility.isTrusted()) return { pasted: false, reason: "no-permission" };
    this.delivering = true;
    try {
      this.deps.window.hide();
      await this.restoreFocus();
      await this.deps.delay(FOCUS_SETTLE_MS);
      await this.deps.front.paste();
      return { pasted: true };
    } catch {
      // The keystroke failed (permission revoked in between): the clipboard still holds the citation.
      return { pasted: false, reason: "no-permission" };
    } finally {
      this.delivering = false;
    }
  }

  requestAccessibility(): void {
    this.deps.accessibility.prompt();
  }

  dispose(): void {
    if (this.accelerator !== undefined) this.deps.shortcuts.unregister(this.accelerator);
    this.accelerator = undefined;
  }

  private async restoreFocus(): Promise<void> {
    const id = this.previous;
    if (!id || id === this.deps.ownBundleId) return;
    try {
      await this.deps.front.activate(id);
    } catch {
      // The app quit while the palette was open; nothing to restore.
    }
  }
}
