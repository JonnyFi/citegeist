import type { QuickInsertBridge } from "@citegeist/ui/quick-insert";
import { contextBridge, ipcRenderer } from "electron";
import { QI } from "./channels.js";

// Preload of the palette window. Sandboxed, so it only imports electron and plain modules.
// The core connection is read again on every call: a library switch changes port and token.
const bridge: QuickInsertBridge = {
  connection: () =>
    ipcRenderer.sendSync("citegeist:connection") as ReturnType<QuickInsertBridge["connection"]>,
  deliver: (payload) => ipcRenderer.invoke(QI.deliver, payload),
  close: () => ipcRenderer.send(QI.close),
  requestAccessibility: () => ipcRenderer.send(QI.requestAccessibility),
  target: () => ipcRenderer.sendSync(QI.target) as ReturnType<QuickInsertBridge["target"]>,
  onShow(listener) {
    const handler = (_event: Electron.IpcRendererEvent, target: Parameters<typeof listener>[0]) =>
      listener(target);
    ipcRenderer.on(QI.show, handler);
    return () => {
      ipcRenderer.removeListener(QI.show, handler);
    };
  },
  hotkey: () => ipcRenderer.sendSync(QI.hotkey) as string,
  platform: process.platform,
};

contextBridge.exposeInMainWorld("citegeistQuickInsert", bridge);
