/** IPC channels between the palette window and the main process. */
export const QI = {
  /** invoke: write the clipboard and paste. Payload { html?, text }. Result DeliverResult. */
  deliver: "citegeist:quick-insert:deliver",
  /** send: hide the palette and restore focus. */
  close: "citegeist:quick-insert:close",
  /** send: open the macOS prompt for the Accessibility permission. */
  requestAccessibility: "citegeist:quick-insert:request-accessibility",
  /** main to renderer: the palette was shown. */
  show: "citegeist:quick-insert:show",
  /** sendSync: the hotkey as an Electron accelerator. */
  hotkey: "citegeist:quick-insert:hotkey",
  /** invoke: read the settings (main renderer and palette). */
  getSettings: "citegeist:quick-insert:get-settings",
  /** invoke: change the settings. Result { ok, error? }. */
  setSettings: "citegeist:quick-insert:set-settings",
} as const;
