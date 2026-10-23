import { describe, expect, it, vi } from "vitest";
import { FOCUS_SETTLE_MS, QuickInsertController, type QuickInsertDeps } from "./controller.js";

function setup(
  over: {
    trusted?: boolean;
    supportsPaste?: boolean;
    frontmost?: string | undefined;
    taken?: string[];
  } = {},
) {
  const log: string[] = [];
  let visible = false;
  let shortcutCallback: (() => void) | undefined;
  const taken = new Set(over.taken ?? []);
  const deps: QuickInsertDeps = {
    shortcuts: {
      register: vi.fn((accelerator: string, cb: () => void) => {
        if (taken.has(accelerator)) return false;
        shortcutCallback = cb;
        log.push(`register ${accelerator}`);
        return true;
      }),
      unregister: vi.fn((accelerator: string) => {
        log.push(`unregister ${accelerator}`);
      }),
    },
    window: {
      show: () => {
        visible = true;
        log.push("show");
      },
      hide: () => {
        visible = false;
        log.push("hide");
      },
      isVisible: () => visible,
    },
    notifyShown: () => log.push("notify"),
    clipboard: {
      write: vi.fn(
        async (d: { html?: string; text: string }) => void log.push(`clipboard ${d.text}`),
      ),
    },
    front: {
      supportsPaste: over.supportsPaste ?? true,
      capture: vi.fn(async () => ("frontmost" in over ? over.frontmost : "com.apple.Safari")),
      activate: vi.fn(async (id: string) => void log.push(`activate ${id}`)),
      paste: vi.fn(async () => void log.push("paste")),
    },
    accessibility: {
      isTrusted: () => over.trusted ?? true,
      prompt: vi.fn(() => void log.push("prompt")),
    },
    delay: vi.fn(async (ms: number) => void log.push(`delay ${ms}`)),
  };
  const controller = new QuickInsertController(deps);
  return { controller, deps, log, press: () => shortcutCallback?.(), isVisible: () => visible };
}

describe("hotkey", () => {
  it("registers the accelerator and replaces it on change", () => {
    const { controller, log } = setup();
    expect(controller.setHotkey("CommandOrControl+Shift+K")).toEqual({ ok: true });
    expect(controller.setHotkey("Alt+Space")).toEqual({ ok: true });
    expect(log).toEqual([
      "register CommandOrControl+Shift+K",
      "register Alt+Space",
      "unregister CommandOrControl+Shift+K",
    ]);
    expect(controller.hotkey).toBe("Alt+Space");
  });

  it("keeps the old hotkey when the new one is taken, and says so", () => {
    const { controller, log } = setup({ taken: ["Alt+Space"] });
    controller.setHotkey("CommandOrControl+Shift+K");
    const result = controller.setHotkey("Alt+Space");
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.error).toContain("Alt+Space is taken");
    expect(controller.hotkey).toBe("CommandOrControl+Shift+K");
    expect(log).not.toContain("unregister CommandOrControl+Shift+K");
  });

  it("turns the hotkey off with undefined", () => {
    const { controller, log } = setup();
    controller.setHotkey("CommandOrControl+Shift+K");
    controller.setHotkey(undefined);
    expect(log.at(-1)).toBe("unregister CommandOrControl+Shift+K");
    expect(controller.hotkey).toBeUndefined();
  });
});

describe("opening and closing", () => {
  it("remembers the frontmost app before it shows the palette", async () => {
    const { controller, deps, log } = setup();
    controller.setHotkey("Alt+Space");
    await controller.open();
    expect(log.slice(-2)).toEqual(["show", "notify"]);
    expect(deps.front.capture).toHaveBeenCalledTimes(1);
  });

  it("opens on the hotkey and closes on a second press", async () => {
    const { controller, press, isVisible, log } = setup();
    controller.setHotkey("Alt+Space");
    press();
    await vi.waitFor(() => expect(isVisible()).toBe(true));
    press();
    await vi.waitFor(() => expect(isVisible()).toBe(false));
    expect(log).toContain("activate com.apple.Safari");
  });

  it("Escape hides the palette and restores focus to the previous app", async () => {
    const { controller, log } = setup({ frontmost: "com.microsoft.Word" });
    await controller.open();
    await controller.close();
    expect(log.slice(-2)).toEqual(["hide", "activate com.microsoft.Word"]);
  });

  it("does not open twice on a fast double press", async () => {
    const { controller, deps } = setup();
    await Promise.all([controller.open(), controller.open()]);
    expect(deps.front.capture).toHaveBeenCalledTimes(1);
  });

  it("restores nothing when the frontmost app was unknown", async () => {
    const { controller, deps } = setup({ frontmost: undefined });
    await controller.open();
    await controller.close();
    expect(deps.front.activate).not.toHaveBeenCalled();
  });

  it("closing a hidden palette does nothing", async () => {
    const { controller, deps } = setup();
    await controller.close();
    expect(deps.front.activate).not.toHaveBeenCalled();
  });

  it("hides on blur but leaves focus where the user put it", async () => {
    const { controller, deps, isVisible } = setup();
    await controller.open();
    controller.blurred();
    expect(isVisible()).toBe(false);
    expect(deps.front.activate).not.toHaveBeenCalled();
  });
});

describe("deliver", () => {
  const payload = { html: "<blockquote>q</blockquote>", text: "q" };

  it("copies, hides, restores focus and pastes when the Accessibility permission is granted", async () => {
    const { controller, log, deps } = setup({ trusted: true, frontmost: "com.google.Chrome" });
    await controller.open();
    log.length = 0;
    expect(await controller.deliver(payload)).toEqual({ pasted: true });
    expect(log).toEqual([
      "clipboard q",
      "hide",
      "activate com.google.Chrome",
      `delay ${FOCUS_SETTLE_MS}`,
      "paste",
    ]);
    expect(deps.clipboard.write).toHaveBeenCalledWith({ html: payload.html, text: "q" });
  });

  it("copies and reports the missing permission, leaving the palette open", async () => {
    const { controller, log, isVisible, deps } = setup({ trusted: false });
    await controller.open();
    log.length = 0;
    expect(await controller.deliver(payload)).toEqual({ pasted: false, reason: "no-permission" });
    expect(log).toEqual(["clipboard q"]);
    expect(isVisible()).toBe(true);
    expect(deps.front.paste).not.toHaveBeenCalled();
  });

  it("reports platforms that cannot paste", async () => {
    const { controller } = setup({ supportsPaste: false });
    expect(await controller.deliver(payload)).toEqual({ pasted: false, reason: "unsupported" });
  });

  it("falls back to the message when the keystroke fails", async () => {
    const { controller, deps } = setup();
    (deps.front.paste as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("not allowed"));
    await controller.open();
    expect(await controller.deliver(payload)).toEqual({ pasted: false, reason: "no-permission" });
  });

  it("does not hide the palette on blur while it delivers", async () => {
    const { controller, deps } = setup();
    await controller.open();
    let release: () => void = () => {};
    (deps.front.activate as ReturnType<typeof vi.fn>).mockImplementationOnce(
      () => new Promise<void>((resolve) => (release = resolve)),
    );
    const pending = controller.deliver(payload);
    await vi.waitFor(() => expect(deps.front.activate).toHaveBeenCalled());
    controller.blurred();
    release();
    await pending;
    expect(deps.front.paste).toHaveBeenCalledTimes(1);
  });

  it("sends only the text when there is no HTML", async () => {
    const { controller, deps } = setup();
    await controller.deliver({ text: "plain" });
    expect(deps.clipboard.write).toHaveBeenCalledWith({ text: "plain" });
  });

  it("passes the permission prompt through", () => {
    const { controller, log } = setup();
    controller.requestAccessibility();
    expect(log).toContain("prompt");
  });
});

describe("dispose", () => {
  it("releases the hotkey", () => {
    const { controller, log } = setup();
    controller.setHotkey("Alt+Space");
    controller.dispose();
    expect(log.at(-1)).toBe("unregister Alt+Space");
  });
});
