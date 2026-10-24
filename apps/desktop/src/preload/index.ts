import type { CitegeistBridge, CoreConnection } from "@citegeist/ui/bridge";
import { contextBridge, ipcRenderer, webUtils } from "electron";

// The channel names of the quick-insert settings, written out here on purpose: a sandboxed preload
// cannot load a shared chunk, so it must not import ../quick-insert/channels. A test pins them.
const QI_GET_SETTINGS = "citegeist:quick-insert:get-settings";
const QI_SET_SETTINGS = "citegeist:quick-insert:set-settings";

// The connection is read once per page load. After a library switch the main process reloads the
// window, which runs this script again with the new token and port.
const connection = ipcRenderer.sendSync("citegeist:connection") as CoreConnection | null;

const bridge: CitegeistBridge = {
  connection,
  openLibrary: () => ipcRenderer.invoke("citegeist:open-library") as Promise<boolean>,
  createLibrary: () => ipcRenderer.invoke("citegeist:create-library") as Promise<boolean>,
  pickPaths: (options) => ipcRenderer.invoke("citegeist:pick-paths", options) as Promise<string[]>,
  onNavigate(listener) {
    const handler = (_event: Electron.IpcRendererEvent, path: string) => listener(path);
    ipcRenderer.on("citegeist:navigate", handler);
    // Tells the main process the renderer can take navigation requests (queued deep links).
    ipcRenderer.send("citegeist:navigate-ready");
    return () => {
      ipcRenderer.removeListener("citegeist:navigate", handler);
    };
  },
  quickInsert: {
    get: () => ipcRenderer.invoke(QI_GET_SETTINGS),
    set: (patch) => ipcRenderer.invoke(QI_SET_SETTINGS, patch),
  },
  // The path of a file dropped on the window: a File object carries no path in the renderer.
  pathForFile: (file) => webUtils.getPathForFile(file),
  platform: process.platform,
};

contextBridge.exposeInMainWorld("citegeist", bridge);
