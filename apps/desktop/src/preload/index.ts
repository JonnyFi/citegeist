import type { CitegeistBridge, CoreConnection } from "@citegeist/ui/bridge";
import { contextBridge, ipcRenderer } from "electron";

// The connection is read once per page load. After a library switch the main process reloads the
// window, which runs this script again with the new token and port.
const connection = ipcRenderer.sendSync("citegeist:connection") as CoreConnection | null;

const bridge: CitegeistBridge = {
  connection,
  openLibrary: () => ipcRenderer.invoke("citegeist:open-library") as Promise<boolean>,
  createLibrary: () => ipcRenderer.invoke("citegeist:create-library") as Promise<boolean>,
  onNavigate(listener) {
    const handler = (_event: Electron.IpcRendererEvent, path: string) => listener(path);
    ipcRenderer.on("citegeist:navigate", handler);
    // Tells the main process the renderer can take navigation requests (queued deep links).
    ipcRenderer.send("citegeist:navigate-ready");
    return () => {
      ipcRenderer.removeListener("citegeist:navigate", handler);
    };
  },
  platform: process.platform,
};

contextBridge.exposeInMainWorld("citegeist", bridge);
