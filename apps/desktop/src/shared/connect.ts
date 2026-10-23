import { pidAlive, readLock, readToken } from "./lockfile.js";

/** What the renderer needs to reach a core. Mirrors CoreConnection of @citegeist/ui. */
export interface Connection {
  url: string;
  wsUrl: string;
  token: string;
  library: string;
}

export function connectionFor(port: number, token: string, library: string): Connection {
  return {
    url: `http://127.0.0.1:${port}`,
    wsUrl: `ws://127.0.0.1:${port}/events?token=${token}`,
    token,
    library,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function healthy(port: number, token: string): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(1500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Looks for a live core in the local directory of a library and checks it with an authenticated
 * health call. A lock with port 0 means the core is still starting; `waitMs` bounds how long to
 * wait for it. Stale locks (dead pid) and dead ports yield undefined.
 */
export async function findRunningCore(
  dir: string,
  library: string,
  waitMs = 0,
): Promise<Connection | undefined> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    const lock = readLock(dir);
    if (lock && lock.port > 0 && pidAlive(lock.pid)) {
      const token = readToken(dir);
      if (token && (await healthy(lock.port, token))) {
        return connectionFor(lock.port, token, library);
      }
    }
    if (Date.now() >= deadline) return undefined;
    await sleep(100);
  }
}
