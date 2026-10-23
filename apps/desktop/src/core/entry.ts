import { LockHeldError, startCoreServer } from "./server.js";

/**
 * Entry of the core process. The Electron main process starts it as a utilityProcess and passes
 * its settings as environment variables. It also runs under plain Node (messages go to stdout as
 * JSON lines), which is how a headless start would use it.
 *
 * Messages to the parent:
 *   { type: "ready", port, token, library }
 *   { type: "locked", pid, port }      another core already serves this library
 *   { type: "error", message }
 * Messages from the parent:
 *   { type: "shutdown" }
 */

type Outgoing =
  | { type: "ready"; port: number; token: string; library: string }
  | { type: "locked"; pid: number; port: number }
  | { type: "error"; message: string };

const parentPort = (process as NodeJS.Process & { parentPort?: Electron.ParentPort }).parentPort;

function send(message: Outgoing): void {
  if (parentPort) parentPort.postMessage(message);
  else process.stdout.write(`${JSON.stringify(message)}\n`);
}

async function main(): Promise<void> {
  const library = process.env.CITEGEIST_LIBRARY;
  if (!library) {
    send({ type: "error", message: "CITEGEIST_LIBRARY is not set" });
    process.exit(2);
  }
  const origins = process.env.CITEGEIST_ORIGINS?.split(",").filter(Boolean);
  let core: Awaited<ReturnType<typeof startCoreServer>>;
  try {
    core = await startCoreServer({
      library,
      init: process.env.CITEGEIST_INIT === "1",
      ...(process.env.CITEGEIST_LOCAL_BASE ? { localBase: process.env.CITEGEIST_LOCAL_BASE } : {}),
      ...(origins && origins.length > 0 ? { allowedOrigins: origins } : {}),
    });
  } catch (err) {
    if (err instanceof LockHeldError) {
      send({ type: "locked", pid: err.holder.pid, port: err.holder.port });
      process.exit(0);
    }
    send({ type: "error", message: err instanceof Error ? err.message : String(err) });
    process.exit(1);
  }

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await core.close().catch(() => {});
    process.exit(0);
  };
  parentPort?.on("message", (e) => {
    if ((e.data as { type?: string } | undefined)?.type === "shutdown") void stop();
  });
  process.on("SIGTERM", () => void stop());
  process.on("SIGINT", () => void stop());

  send({ type: "ready", port: core.port, token: core.token, library: core.library.root });
}

void main();
