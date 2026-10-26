import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { defaultLocalBase } from "@citegeist/server/lockfile";
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, session, shell } from "electron";
import { type QuickInsertHandle, registerQuickInsert } from "../quick-insert/electron.js";
import { deepLinkToPath, findDeepLink, PROTOCOL } from "../shared/deeplink.js";
import {
  languageFromPreferred,
  type MainLang,
  mainLanguage,
  mt,
  setMainLanguage,
} from "../shared/text.js";
import { isTrustedSender, ownRendererUrl } from "../shared/trusted-sender.js";
import { aboutInfo, aboutLines, noticePath, REPOSITORY_URL } from "./about.js";
import { ensureCore, type RunningCore, stopCore } from "./core-process.js";
import { RotatingLog } from "./log.js";
import { buildMenu } from "./menu.js";
import { openDialogOptions, type PickPathsRequest } from "./pick-paths.js";
import { loadSettings, saveSettings } from "./settings.js";
import {
  CHECK_INTERVAL_MS,
  checkForUpdate,
  RELEASES_API,
  type UpdateInfo,
  writeInstallCommand,
} from "./update-check.js";

// Test and dev switches, all optional.
//   CITEGEIST_LIBRARY      library to open at start (also --library=<path>)
//   CITEGEIST_LOCAL_BASE   machine-local base for index and lock (default Application Support)
//   CITEGEIST_USER_DATA    Electron userData directory (isolates settings and the instance lock)
//   ELECTRON_RENDERER_URL  Vite dev server of apps/ui instead of the built files
if (process.env.CITEGEIST_USER_DATA) app.setPath("userData", process.env.CITEGEIST_USER_DATA);
app.setName("citegeist");

// Log file ----------------------------------------------------------------------------------------
// A packaged app started from the Dock has no terminal, so what the core and the main process say
// goes to ~/Library/Logs/citegeist/core.log (5 MB, three files). The test switch keeps the log
// next to the isolated userData directory.
const LOG_DIR = process.env.CITEGEIST_USER_DATA
  ? join(process.env.CITEGEIST_USER_DATA, "logs")
  : app.getPath("logs");
const log = new RotatingLog(join(LOG_DIR, "core.log"));

function logLine(source: string, message: string): void {
  log.write(source, message);
  if (!app.isPackaged) process.stderr.write(`[${source}] ${message}\n`);
}

for (const level of ["log", "info", "warn", "error"] as const) {
  const original = console[level].bind(console);
  console[level] = (...args: unknown[]) => {
    original(...args);
    log.write(
      "main",
      args.map((a) => (a instanceof Error ? (a.stack ?? a.message) : String(a))).join(" "),
    );
  };
}
process.on("uncaughtExceptionMonitor", (err) => log.write("main", `uncaught: ${err.stack ?? err}`));
process.on("unhandledRejection", (reason) =>
  log.write("main", `unhandled rejection: ${String(reason)}`),
);

const CORE_ENTRY = join(import.meta.dirname, "core.js");
const PRELOAD = join(import.meta.dirname, "../preload/index.cjs");
const UI_INDEX = resolve(import.meta.dirname, "../../../ui/dist/index.html");
const RENDERER_URL = process.env.ELECTRON_RENDERER_URL;
/** True for the pages of the app's own renderer. Everything else is foreign (M8). */
const isOwnUrl = ownRendererUrl({ rendererUrl: RENDERER_URL, uiIndex: UI_INDEX });

// Dock icon of an unpackaged run (pnpm dev). The packaged app takes build/icon.icns from its
// bundle. Neither BrowserWindow sets an icon of its own, so the dock icon is the app icon.
const DEV_ICON = resolve(import.meta.dirname, "../../build/icon.png");

const QUICK_INSERT_PRELOAD = join(import.meta.dirname, "../preload/quick-insert.cjs");

let window: BrowserWindow | null = null;
let quickInsert: QuickInsertHandle | undefined;
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
  logLine("main", `${title}: ${err instanceof Error ? err.message : String(err)}`);
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
      onOutput: (line) => log.write("core", line),
      packaged: app.isPackaged,
      ...(process.env.CITEGEIST_LOCAL_BASE ? { localBase: process.env.CITEGEIST_LOCAL_BASE } : {}),
    });
  } catch (err) {
    fail(mt("library.open.error"), err);
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
    title: create ? mt("library.create.title") : mt("library.open.title"),
    buttonLabel: create ? mt("library.create.button") : mt("library.open.button"),
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
    message: create ? mt("library.create.ask") : mt("library.notALibrary"),
    detail: `${path}\n\n${mt("library.create.detail")}`,
    buttons: [mt("library.create.button"), mt("library.cancel")],
    defaultId: 0,
    cancelId: 1,
  });
  return answer.response === 0 ? useLibrary(path, true) : false;
}

async function pickPaths(request: PickPathsRequest): Promise<string[]> {
  const options = openDialogOptions(request);
  const result = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options);
  return result.canceled ? [] : result.filePaths;
}

function startupLibrary(): string | undefined {
  const arg = process.argv.find((a) => a.startsWith("--library="))?.slice("--library=".length);
  const candidates = [arg, process.env.CITEGEIST_LIBRARY, loadSettings().lastLibrary];
  return candidates.find(
    (c): c is string => Boolean(c) && existsSync(join(c as string, "citegeist.json")),
  );
}

// Language, menu and About ---------------------------------------------------------------------------

function applyMenu(): void {
  Menu.setApplicationMenu(
    buildMenu({
      openLibrary: () => void chooseLibrary(false),
      createLibrary: () => void chooseLibrary(true),
      navigate,
      about: () => void showAbout(),
    }),
  );
}

function currentAbout() {
  return aboutInfo({
    library: core?.connection.library,
    dataDir: process.env.CITEGEIST_LOCAL_BASE ?? defaultLocalBase(),
    logFile: log.file,
  });
}

/** Native About window: version, license and paths, with buttons for the log, NOTICE and the repository. */
async function showAbout(): Promise<void> {
  const info = currentAbout();
  const options: Electron.MessageBoxOptions = {
    type: "info",
    title: mt("about.title"),
    message: `citegeist`,
    detail: aboutLines(info).join("\n"),
    buttons: [
      mt("about.close"),
      mt("about.openLog"),
      mt("about.openNotice"),
      mt("about.openRepository"),
    ],
    defaultId: 0,
    cancelId: 0,
  };
  const answer = window
    ? await dialog.showMessageBox(window, options)
    : await dialog.showMessageBox(options);
  if (answer.response === 1) await openLog();
  else if (answer.response === 2) await openNotice();
  else if (answer.response === 3) await shell.openExternal(REPOSITORY_URL);
}

async function openLog(): Promise<void> {
  const error = await shell.openPath(log.file);
  if (error) logLine("main", `could not open the log: ${error}`);
}

async function openNotice(): Promise<void> {
  const path = noticePath();
  if (!path) {
    dialog.showErrorBox(mt("about.title"), mt("about.noticeMissing"));
    return;
  }
  await shell.openPath(path);
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
    if (!isOwnUrl(url)) {
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

// The handlers give out the token of the core and open file dialogs, so they answer the app's own
// renderer only (M8). A message from any other page or frame is dropped.
const fromRenderer = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): boolean =>
  isTrustedSender(event.senderFrame, isOwnUrl);

ipcMain.on("citegeist:connection", (event) => {
  event.returnValue = fromRenderer(event) ? (core?.connection ?? null) : null;
});
ipcMain.on("citegeist:navigate-ready", (event) => {
  if (!fromRenderer(event)) return;
  rendererReady = true;
  if (pendingPath) {
    const path = pendingPath;
    pendingPath = undefined;
    navigate(path);
  }
});
ipcMain.handle("citegeist:open-library", (event) =>
  fromRenderer(event) ? chooseLibrary(false) : false,
);
ipcMain.handle("citegeist:create-library", (event) =>
  fromRenderer(event) ? chooseLibrary(true) : false,
);
ipcMain.handle("citegeist:pick-paths", (event, request: PickPathsRequest) =>
  fromRenderer(event) ? pickPaths(request) : [],
);

ipcMain.on("citegeist:set-language", (event, lang: unknown) => {
  if (!fromRenderer(event) || (lang !== "de" && lang !== "en")) return;
  const next: MainLang = lang;
  if (next === loadSettings().language && next === mainLanguage()) return;
  setMainLanguage(next);
  void saveSettings({ language: next });
  if (app.isReady()) applyMenu();
});
ipcMain.handle("citegeist:about-get", (event) => (fromRenderer(event) ? currentAbout() : null));
ipcMain.handle("citegeist:about-open-log", (event) =>
  fromRenderer(event) ? openLog() : undefined,
);
ipcMain.handle("citegeist:about-open-notice", (event) =>
  fromRenderer(event) ? openNotice() : undefined,
);
ipcMain.handle("citegeist:about-reveal-logs", (event) => {
  if (fromRenderer(event)) shell.showItemInFolder(log.file);
});

// Updates ----------------------------------------------------------------------------------------------

let availableUpdate: UpdateInfo | null = loadSettings().update?.available ?? null;

/**
 * Asks the releases API (at most once a day, see checkForUpdate) and tells the window when the
 * answer changed. Only the packaged app checks; CITEGEIST_UPDATE_API points a dev build at a test
 * endpoint.
 */
async function refreshUpdate(): Promise<void> {
  const api = process.env.CITEGEIST_UPDATE_API;
  if (!app.isPackaged && !api) return;
  const before = loadSettings().update ?? {};
  const next = await checkForUpdate({
    current: app.getVersion(),
    state: before,
    ...(api ? { api } : { api: RELEASES_API }),
  });
  await saveSettings({ update: next });
  const info = next.available ?? null;
  if (info?.version === availableUpdate?.version) return;
  availableUpdate = info;
  window?.webContents.send("citegeist:update-changed", info);
}

/** Opens Terminal on a script that runs install.sh. The script quits this app and replaces it. */
function installUpdate(): void {
  const script = writeInstallCommand(app.getPath("userData"));
  execFile("open", ["-a", "Terminal", script], (err) => {
    if (err) fail(mt("update.terminalError"), err);
  });
}

ipcMain.handle("citegeist:update-get", (event) => (fromRenderer(event) ? availableUpdate : null));
ipcMain.handle("citegeist:update-install", (event) => {
  if (fromRenderer(event) && availableUpdate) installUpdate();
});

// Lifecycle ------------------------------------------------------------------------------------------------

app.on("before-quit", (event) => {
  quickInsert?.dispose();
  quickInsert = undefined;
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
  if (process.platform === "darwin" && !app.isPackaged && existsSync(DEV_ICON)) {
    app.dock?.setIcon(nativeImage.createFromPath(DEV_ICON));
  }
  // Everything is denied except writing to the clipboard, which "copy citation" needs.
  const allowed = (permission: string) => permission === "clipboard-sanitized-write";
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) =>
    callback(allowed(permission)),
  );
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => allowed(permission));
  setMainLanguage(
    loadSettings().language ?? languageFromPreferred(app.getPreferredSystemLanguages()),
  );
  applyMenu();
  logLine("main", `citegeist ${app.getVersion()} started (${process.platform} ${process.arch})`);

  const initial = startupLibrary();
  if (initial) {
    try {
      core = await ensureCore({
        library: initial,
        entry: CORE_ENTRY,
        origins: rendererOrigins(),
        onOutput: (line) => log.write("core", line),
        packaged: app.isPackaged,
        ...(process.env.CITEGEIST_LOCAL_BASE
          ? { localBase: process.env.CITEGEIST_LOCAL_BASE }
          : {}),
      });
    } catch (err) {
      fail(mt("library.open.error"), err);
    }
  }
  createWindow();
  // After the main window, so that it stays the first window the app opens.
  quickInsert = registerQuickInsert({
    userDataDir: app.getPath("userData"),
    preload: QUICK_INSERT_PRELOAD,
    load: (w) =>
      RENDERER_URL
        ? w.loadURL(`${RENDERER_URL}#/quick-insert`)
        : w.loadFile(UI_INDEX, { hash: "/quick-insert" }),
    isOwnUrl,
    onHotkeyError: (message) => dialog.showErrorBox(mt("quickInsert.hotkeyError"), message),
  });
  const link = findDeepLink(process.argv);
  if (link) handleDeepLink(link);
  void refreshUpdate();
  setInterval(() => void refreshUpdate(), CHECK_INTERVAL_MS / 4).unref();
  if (core) window?.setTitle(`citegeist - ${core.connection.library.split("/").pop()}`);
}

if (primaryInstance) void start();
