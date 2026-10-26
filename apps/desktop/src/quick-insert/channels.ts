/** IPC channels between the palette window and the main process. */
export const QI = {
  /**
   * invoke: write the clipboard and paste (payload { html?, text }), or insert into the open text
   * of the main window (payload { kind: "editor", text }, no clipboard). Result DeliverResult.
   */
  deliver: "citegeist:quick-insert:deliver",
  /** send: hide the palette and restore focus. */
  close: "citegeist:quick-insert:close",
  /** send: open the macOS prompt for the Accessibility permission. */
  requestAccessibility: "citegeist:quick-insert:request-accessibility",
  /** main to renderer: the palette was shown. Payload PaletteTarget. */
  show: "citegeist:quick-insert:show",
  /** sendSync: where a citation goes now, for the first show (PaletteTarget). */
  target: "citegeist:quick-insert:target",
  /** send from the main window: the open text, { project, text, lang? } or null. */
  editorState: "citegeist:quick-insert:editor-state",
  /** main to the main window: a Pandoc snippet for the open text. */
  insert: "citegeist:quick-insert:insert",
  /** sendSync: the hotkey as an Electron accelerator. */
  hotkey: "citegeist:quick-insert:hotkey",
  /** invoke: read the settings (main renderer and palette). */
  getSettings: "citegeist:quick-insert:get-settings",
  /** invoke: change the settings. Result { ok, error? }. */
  setSettings: "citegeist:quick-insert:set-settings",
} as const;
