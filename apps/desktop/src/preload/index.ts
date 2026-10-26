import type { CitegeistBridge, CoreConnection } from "@citegeist/ui/bridge";
import { contextBridge, ipcRenderer, webUtils } from "electron";

// The channel names of the quick-insert settings, written out here on purpose: a sandboxed preload
// cannot load a shared chunk, so it must not import ../quick-insert/channels. A test pins them.
const QI_GET_SETTINGS = "citegeist:quick-insert:get-settings";
const QI_SET_SETTINGS = "citegeist:quick-insert:set-settings";
// The main window tells the palette's controller which text is open, and receives its snippets.
const QI_EDITOR_STATE = "citegeist:quick-insert:editor-state";
const QI_INSERT = "citegeist:quick-insert:insert";

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
  textLink: {
    publish: (text) => ipcRenderer.send(QI_EDITOR_STATE, text),
    onInsert(listener) {
      const handler = (_event: Electron.IpcRendererEvent, snippet: string) => listener(snippet);
      ipcRenderer.on(QI_INSERT, handler);
      return () => {
        ipcRenderer.removeListener(QI_INSERT, handler);
      };
    },
  },
  update: {
    get: () => ipcRenderer.invoke("citegeist:update-get"),
    install: () => ipcRenderer.invoke("citegeist:update-install"),
    onChange(listener) {
      const handler = (_event: Electron.IpcRendererEvent, info: Parameters<typeof listener>[0]) =>
        listener(info);
      ipcRenderer.on("citegeist:update-changed", handler);
      return () => {
        ipcRenderer.removeListener("citegeist:update-changed", handler);
      };
    },
  },
  setLanguage: (lang) => ipcRenderer.send("citegeist:set-language", lang),
  about: {
    get: () => ipcRenderer.invoke("citegeist:about-get"),
    openLog: () => ipcRenderer.invoke("citegeist:about-open-log"),
    openNotice: () => ipcRenderer.invoke("citegeist:about-open-notice"),
    revealLogFolder: () => ipcRenderer.invoke("citegeist:about-reveal-logs"),
  },
  // The path of a file dropped on the window: a File object carries no path in the renderer.
  pathForFile: (file) => webUtils.getPathForFile(file),
  platform: process.platform,
};

contextBridge.exposeInMainWorld("citegeist", bridge);
