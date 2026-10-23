import type { OperationContract } from "@citegeist/ops";
import { type ClientLink, createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { z } from "zod";
import type { CoreConnection } from "../bridge";

/** A change in the library folder. The UI refetches what it shows when one arrives. */
export interface CoreEvent {
  type: "change";
  path: string;
  external: boolean;
}

/**
 * The renderer's view of the core. `call` is typed by the ops contract you pass in, so a call
 * site cannot send the wrong input or misread the output.
 */
export interface Core {
  /** "mock" or the library path, shown in the window chrome. */
  label: string;
  isMock: boolean;
  call<C extends OperationContract>(
    contract: C,
    input: z.input<C["input"]>,
  ): Promise<z.output<C["output"]>>;
  subscribe(listener: (event: CoreEvent) => void): () => void;
  close(): void;
}

type DynamicClient = { [segment: string]: DynamicClient } & ((input: unknown) => Promise<unknown>);

/** Wraps any oRPC link into a Core. Operation `items.list` becomes the procedure path items/list. */
export function coreFromLink(
  link: ClientLink<Record<never, never>>,
  extra: {
    label: string;
    isMock: boolean;
    subscribe: Core["subscribe"];
    close?: () => void;
  },
): Core {
  const client = createORPCClient<DynamicClient>(link);
  return {
    label: extra.label,
    isMock: extra.isMock,
    subscribe: extra.subscribe,
    close: extra.close ?? (() => {}),
    async call(contract, input) {
      let target: DynamicClient = client;
      for (const segment of contract.name.split(".")) target = target[segment] as DynamicClient;
      return (await target(input)) as never;
    },
  };
}

/** Core reached over HTTP and WebSocket on 127.0.0.1, as started by the Electron main process. */
export function createRemoteCore(conn: CoreConnection): Core {
  const link = new RPCLink({
    url: `${conn.url}/rpc`,
    headers: { authorization: `Bearer ${conn.token}` },
  });
  const listeners = new Set<(event: CoreEvent) => void>();
  let socket: WebSocket | undefined;
  let closed = false;
  let retry: ReturnType<typeof setTimeout> | undefined;

  const connect = () => {
    if (closed) return;
    socket = new WebSocket(conn.wsUrl);
    socket.onmessage = (msg) => {
      try {
        const event = JSON.parse(String(msg.data)) as CoreEvent;
        if (event.type === "change") for (const l of listeners) l(event);
      } catch {
        // ignore malformed frames
      }
    };
    socket.onclose = () => {
      if (!closed) retry = setTimeout(connect, 1000);
    };
  };
  connect();

  return coreFromLink(link, {
    label: conn.library,
    isMock: false,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close() {
      closed = true;
      if (retry) clearTimeout(retry);
      socket?.close();
    },
  });
}
