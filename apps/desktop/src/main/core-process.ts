import { type UtilityProcess, utilityProcess } from "electron";
import { type Connection, connectionFor, findRunningCore } from "@citegeist/server/connect";
import { defaultLocalBase, localDir, readLibraryId } from "@citegeist/server/lockfile";

export interface RunningCore {
  connection: Connection;
  /** Set when this app started the core and therefore stops it on quit. */
  child?: UtilityProcess;
}

export interface EnsureCoreOptions {
  library: string;
  /** Create the library when the folder is not one yet. */
  init?: boolean;
  /** Absolute path of the bundled core entry (out/main/core.js). */
  entry: string;
  localBase?: string;
  /** Origins the core accepts browser calls from, besides the packaged app. */
  origins?: string[];
}

type CoreMessage =
  | { type: "ready"; port: number; token: string; library: string }
  | { type: "locked"; pid: number; port: number }
  | { type: "error"; message: string };

const START_TIMEOUT_MS = 60_000;

/**
 * Connects to the core of a library. If one is already running (lock with live pid that answers
 * an authenticated health call) the app attaches to it. Otherwise it starts one as a
 * utilityProcess. When two apps race, the loser gets `locked` from the core and attaches too.
 */
export async function ensureCore(opts: EnsureCoreOptions): Promise<RunningCore> {
  const localBase = opts.localBase ?? defaultLocalBase();
  const id = readLibraryId(opts.library);
  const dir = id ? localDir(localBase, id) : undefined;

  if (dir) {
    const running = await findRunningCore(dir, opts.library);
    if (running) return { connection: running };
  }

  const child = utilityProcess.fork(opts.entry, [], {
    serviceName: "citegeist-core",
    stdio: "inherit",
    env: {
      ...process.env,
      CITEGEIST_LIBRARY: opts.library,
      CITEGEIST_LOCAL_BASE: localBase,
      CITEGEIST_INIT: opts.init ? "1" : "0",
      CITEGEIST_ORIGINS: ["null", "file://", ...(opts.origins ?? [])].join(","),
    } as Record<string, string>,
  });

  const message = await new Promise<CoreMessage>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("the core did not start within 60 seconds"));
    }, START_TIMEOUT_MS);
    child.once("message", (m: CoreMessage) => {
      clearTimeout(timer);
      resolve(m);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`the core exited with code ${code} before it was ready`));
    });
  });

  if (message.type === "ready") {
    return { connection: connectionFor(message.port, message.token, message.library), child };
  }
  if (message.type === "locked") {
    const attach = dir ?? localDir(localBase, readLibraryId(opts.library) ?? "");
    const running = await findRunningCore(attach, opts.library, 15_000);
    if (running) return { connection: running };
    throw new Error(`another core (pid ${message.pid}) holds this library but does not answer`);
  }
  child.kill();
  throw new Error(message.message);
}

/** Asks the core to close the library cleanly, then kills it if it hangs. */
export async function stopCore(child: UtilityProcess): Promise<void> {
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      child.kill();
      resolve();
    }, 3000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    child.postMessage({ type: "shutdown" });
  });
}
