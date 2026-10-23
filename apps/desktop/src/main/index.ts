import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { app, BrowserWindow, dialog, ipcMain, Menu, session, shell } from "electron";
import { deepLinkToPath, findDeepLink, PROTOCOL } from "../shared/deeplink.js";
import { ensureCore, type RunningCore, stopCore } from "./core-process.js";
import { buildMenu } from "./menu.js";
import { loadSettings, saveSettings } from "./settings.js";

// Test and dev switches, all optional.
//   CITEGEIST_LIBRARY      library to open at start (also --library=<path>)
//   CITEGEIST_LOCAL_BASE   machine-local base for index and lock (default Application Support)
//   CITEGEIST_USER_DATA    Electron userData directory (isolates settings and the instance lock)
//   ELECTRON_RENDERER_URL  Vite dev server of apps/ui instead of the built files
if (process.env.CITEGEIST_USER_DATA) app.setPath("userData", process.env.CITEGEIST_USER_DATA);
app.setName("citegeist");

const CORE_ENTRY = join(import.meta.dirname, "core.js");
const PRELOAD = join(import.meta.dirname, "../preload/index.cjs");
const UI_INDEX = resolve(import.meta.dirname, "../../../ui/dist/index.html");
const RENDERER_URL = process.env.ELECTRON_RENDERER_URL;

let window: BrowserWindow | null = null;
let core: RunningCore | null = null;
let pendingPath: string | undefined;
let rendererReady = false;
let quitting = false;

// Single instance, deep links ---------------------------------------------------------------------

const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) app.quit();

if (process.defaultApp && process.argv[1]) {
  app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [resolve(process.argv[1])]);
} else {
  app.setAsDefaultProtocolClient(PROTOCOL);
}

function handleDeepLink(raw: string): void {
  const path = deepLinkToPath(raw);
  if (path) navigate(path);
}

function navigate(path: string): void {
  if (window && rendererReady) {
    window.webContents.send("citegeist:navigate", path);
    if (window.isMinimized()) window.restore();
    window.focus();
  } else {
    pendingPath = path;
  }
}

app.on("open-url", (event, url) => {
  event.preventDefault();
  handleDeepLink(url);
});

app.on("second-instance", (_event, argv) => {
  const link = findDeepLink(argv);
  if (link) handleDeepLink(link);
  else if (window) {
    if (window.isMinimized()) window.restore();
    window.focus();
  }
});

// Libraries -------------------------------------------------------------------------------------------

function fail(title: string, err: unknown): void {
  dialog.showErrorBox(title, err instanceof Error ? err.message : String(err));
}

function rendererOrigins(): string[] {
  return RENDERER_URL ? [new URL(RENDERER_URL).origin] : [];
}

/** Starts or attaches to the core of `path`, makes it current and reloads the window. */
async function useLibrary(path: string, init = false): Promise<boolean> {
  let next: RunningCore;
  try {
    next = await ensureCore({
      library: path,
      init,
      entry: CORE_ENTRY,
      origins: rendererOrigins(),
      ...(process.env.CITEGEIST_LOCAL_BASE ? { localBase: process.env.CITEGEIST_LOCAL_BASE } : {}),
    });
  } catch (err) {
    fail("Could not open the library", err);
    return false;
  }
  const previous = core;
  core = next;
  if (previous?.child) await stopCore(previous.child);
  await saveSettings({ lastLibrary: next.connection.library });
  window?.setTitle(`citegeist - ${next.connection.library.split("/").pop()}`);
  window?.webContents.reload();
  return true;
}

async function chooseLibrary(create: boolean): Promise<boolean> {
  const options = {
    title: create ? "Choose a folder for the new library" : "Open a library folder",
    buttonLabel: create ? "Create Library" : "Open",
    properties: create
      ? (["openDirectory", "createDirectory"] as const)
      : (["openDirectory"] as const),
  };
  const result = window
    ? await dialog.showOpenDialog(window, { ...options, properties: [...options.properties] })
    : await dialog.showOpenDialog({ ...options, properties: [...options.properties] });
  const path = result.filePaths[0];
  if (result.canceled || !path) return false;

  if (existsSync(join(path, "citegeist.json"))) return useLibrary(path);
  const answer = await dialog.showMessageBox({
    type: "question",
    message: create ? "Create a library here?" : "This folder is not a citegeist library.",
    detail: `${path}\n\nA new library adds citegeist.json, AGENTS.md and the folders items, notes and projects.`,
    buttons: ["Create Library", "Cancel"],
    defaultId: 0,
    cancelId: 1,
  });
  return answer.response === 0 ? useLibrary(path, true) : false;
}

function startupLibrary(): string | undefined {
  const arg = process.argv.find((a) => a.startsWith("--library="))?.slice("--library=".length);
  const candidates = [arg, process.env.CITEGEIST_LIBRARY, loadSettings().lastLibrary];
  return candidates.find(
    (c): c is string => Boolean(c) && existsSync(join(c as string, "citegeist.json")),
  );
}

// Window ------------------------------------------------------------------------------------------------

function createWindow(): void {
  window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 860,
    minHeight: 560,
    show: false,
    title: "citegeist",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    trafficLightPosition: { x: 16, y: 14 },
    backgroundColor: "#f8f6f1",
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  window.once("ready-to-show", () => window?.show());
  window.webContents.on("did-start-navigation", (_e, _url, _inPlace, isMainFrame) => {
    if (isMainFrame) rendererReady = false;
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    const own = RENDERER_URL ? url.startsWith(RENDERER_URL) : url.startsWith("file://");
    if (!own) {
      event.preventDefault();
      if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    }
  });
  window.on("closed", () => {
    window = null;
    rendererReady = false;
  });

  if (RENDERER_URL) void window.loadURL(RENDERER_URL);
  else void window.loadFile(UI_INDEX);
}

ipcMain.on("citegeist:connection", (event) => {
  event.returnValue = core?.connection ?? null;
});
ipcMain.on("citegeist:navigate-ready", () => {
  rendererReady = true;
  if (pendingPath) {
    const path = pendingPath;
    pendingPath = undefined;
    navigate(path);
  }
});
ipcMain.handle("citegeist:open-library", () => chooseLibrary(false));
ipcMain.handle("citegeist:create-library", () => chooseLibrary(true));

// Lifecycle ------------------------------------------------------------------------------------------------

app.on("before-quit", (event) => {
  if (quitting || !core?.child) return;
  event.preventDefault();
  quitting = true;
  const child = core.child;
  void stopCore(child).finally(() => app.exit(0));
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0 && app.isReady()) createWindow();
});

async function start(): Promise<void> {
  await app.whenReady();
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) =>
    callback(false),
  );
  Menu.setApplicationMenu(
    buildMenu({
      openLibrary: () => void chooseLibrary(false),
      createLibrary: () => void chooseLibrary(true),
      navigate,
    }),
  );

  const initial = startupLibrary();
  if (initial) {
    try {
      core = await ensureCore({
        library: initial,
        entry: CORE_ENTRY,
        origins: rendererOrigins(),
        ...(process.env.CITEGEIST_LOCAL_BASE
          ? { localBase: process.env.CITEGEIST_LOCAL_BASE }
          : {}),
      });
    } catch (err) {
      fail("Could not open the library", err);
    }
  }
  createWindow();
  const link = findDeepLink(process.argv);
  if (link) handleDeepLink(link);
  if (core) window?.setTitle(`citegeist - ${core.connection.library.split("/").pop()}`);
}

if (primaryInstance) void start();
