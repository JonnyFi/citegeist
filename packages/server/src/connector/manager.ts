import type { ConnectorStatus } from "@citegeist/ops";
import type { z } from "zod";
import { attachConnector, type ConnectorHost } from "./attach.js";
import type { ConnectorHandle } from "./server.js";

type Status = z.output<typeof ConnectorStatus>;

/** The parts of a running core the manager needs; `CoreServer` fits. */
export interface ConnectorManagerHost extends ConnectorHost {
  runtime: {
    settings: {
      settings(): Promise<{ connector: { enabled: boolean; port: number } }>;
      subscribe(
        listener: (settings: {
          connector: { enabled: boolean; port: number };
        }) => Promise<void> | void,
      ): () => void;
      status: { connector?: (() => Status) | undefined };
    };
  };
}

export interface ConnectorManager {
  status(): Status;
  /** Resolves when the listener matches the stored settings (first start and every change). */
  ready(): Promise<void>;
  stop(): Promise<void>;
}

/**
 * Keeps the Zotero Connector listener in line with `settings.connector`: off by default, started
 * when the switch goes on, moved when the port changes, stopped when it goes off. A port that is
 * taken (by Zotero, by another citegeist) is not fatal. The status says what happened, and
 * `settings.get` shows it.
 */
export function manageConnector(
  host: ConnectorManagerHost,
  log: (message: string) => void = () => {},
): ConnectorManager {
  const settings = host.runtime.settings;
  let handle: ConnectorHandle | undefined;
  let wanted: { enabled: boolean; port: number } = { enabled: false, port: 0 };
  let status: Status = { state: "off" };
  let queue: Promise<void> = Promise.resolve();
  let stopped = false;

  const apply = (next: { enabled: boolean; port: number }): Promise<void> => {
    queue = queue.then(async () => {
      if (stopped) return;
      if (handle && next.enabled && next.port === wanted.port) return;
      wanted = next;
      await handle?.close();
      handle = undefined;
      if (!next.enabled) {
        status = { state: "off" };
        return;
      }
      try {
        handle = await attachConnector(host, { port: next.port, log });
        status = { state: "listening", port: handle.port };
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        status = { state: "error", port: next.port, detail };
        log(`connector: ${detail}`);
      }
    });
    return queue;
  };

  settings.status.connector = () => status;
  const unsubscribe = settings.subscribe((s) => apply(s.connector));
  const first = settings.settings().then((s) => apply(s.connector));

  return {
    status: () => status,
    ready: () => first,
    async stop() {
      stopped = true;
      unsubscribe();
      await queue;
      await handle?.close();
      handle = undefined;
      status = { state: "off" };
    },
  };
}
