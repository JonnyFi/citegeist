import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type Actor, AgentError, CitegeistError } from "@citegeist/schema";
import { createORPCClient, ORPCError } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { isAlive, readCoreLock } from "./lock.js";

/** Header that carries the caller's actor to a running core. */
export const ACTOR_HEADER = "x-citegeist-actor";

/**
 * A running app core, found through core.lock and core.token in the machine-local directory of
 * the library. `actors` tells whether the core takes the actor from ACTOR_HEADER; without it the
 * core would stamp every forwarded call as "human", so only human calls may be forwarded.
 */
export interface RunningCore {
  url: string;
  token: string;
  pid: number;
  actors: boolean;
}

async function health(
  port: number,
  token: string,
  fetchFn: typeof fetch,
): Promise<{ actors: boolean } | undefined> {
  try {
    const res = await fetchFn(`http://127.0.0.1:${port}/health`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return undefined;
    const body = (await res.json()) as { ok?: unknown; actors?: unknown };
    if (body.ok !== true) return undefined;
    return { actors: body.actors === true };
  } catch {
    return undefined;
  }
}

/**
 * Looks for a live core of this library: a lock with a live pid other than ours and a bound port,
 * a token file, and a core that answers an authenticated health call. Anything else yields
 * undefined, and the caller works in its own process.
 */
export async function findRunningCore(
  localDir: string,
  fetchFn: typeof fetch = fetch,
): Promise<RunningCore | undefined> {
  const lock = readCoreLock(join(localDir, "core.lock"));
  if (!lock?.port || lock.pid === process.pid || !isAlive(lock.pid)) return undefined;
  let token: string;
  try {
    token = readFileSync(join(localDir, "core.token"), "utf8").trim();
  } catch {
    return undefined;
  }
  if (!token) return undefined;
  const ok = await health(lock.port, token, fetchFn);
  if (!ok) return undefined;
  return { url: `http://127.0.0.1:${lock.port}`, token, pid: lock.pid, actors: ok.actors };
}

/** The refusal for an agent write when the running core cannot take the actor over. */
export function actorNotForwardable(operation: string, core: RunningCore): CitegeistError {
  return new CitegeistError({
    code: "LIBRARY_OWNED_BY_APP",
    message: `The citegeist app (pid ${core.pid}) owns this library and this version cannot take the caller's name along, so ${operation} was not run.`,
    fix: "Ask the user to make this change in the citegeist app, or to update the app. Read operations still work.",
    recovery: "ask-human",
    sideEffects: "none",
    context: { operation, pid: core.pid },
  });
}

function unreachable(operation: string, err: unknown): CitegeistError {
  return new CitegeistError({
    code: "CORE_UNREACHABLE",
    message: `The running citegeist core did not answer ${operation}: ${err instanceof Error ? err.message : String(err)}`,
    fix: "Retry in a few seconds. If it repeats, ask the user to restart the citegeist app.",
    recovery: "retry",
    sideEffects: "unknown",
    context: { operation },
  });
}

/** Turns an error from the core's RPC endpoint back into the CitegeistError it was. */
function fromRpc(operation: string, err: unknown): unknown {
  if (!(err instanceof ORPCError)) return unreachable(operation, err);
  const detail = AgentError.safeParse(err.data);
  if (detail.success) return new CitegeistError(detail.data);
  if (err.code === "BAD_REQUEST") {
    return new CitegeistError({
      code: "INVALID_INPUT",
      message: err.message,
      fix: "Correct the listed fields and call the operation again.",
      recovery: "fix-and-retry",
      sideEffects: "none",
    });
  }
  if (err.status === 401) {
    return new CitegeistError({
      code: "CORE_UNREACHABLE",
      message: "The running citegeist core rejected the session token.",
      fix: "Retry once; the app may have restarted. If it repeats, ask the user to restart the app.",
      recovery: "retry",
      sideEffects: "none",
      context: { operation },
    });
  }
  return err;
}

/** Calls one operation on a running core over oRPC, as `actor`. */
export async function forwardCall(
  core: RunningCore,
  operation: string,
  actor: Actor,
  input: unknown,
  fetchFn: typeof fetch = fetch,
): Promise<unknown> {
  const link = new RPCLink({
    url: `${core.url}/rpc`,
    headers: { authorization: `Bearer ${core.token}`, [ACTOR_HEADER]: actor },
    fetch: (request) => fetchFn(request),
  });
  let node: unknown = createORPCClient(link);
  for (const segment of operation.split(".")) {
    node = (node as Record<string, unknown>)[segment];
  }
  try {
    return await (node as (i: unknown) => Promise<unknown>)(input);
  } catch (err) {
    throw fromRpc(operation, err);
  }
}
