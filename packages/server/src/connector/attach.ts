import { basename } from "node:path";
import type { Library } from "@citegeist/core";
import type { Registry } from "@citegeist/ops";
import { type ConnectorHandle, type ConnectorOptions, startConnector } from "./server.js";

/** The part of a running core the connector needs; `CoreServer` fits. */
export interface ConnectorHost {
  registry: Registry;
  library: Library;
}

/**
 * Starts the Zotero Connector listener on top of a running core. Operations run in the registry
 * itself, so the actor can be "agent:zotero-connector" (the oRPC endpoint always acts as human).
 *
 *   const connector = await attachConnector(core, { port: 23119 });
 *   ...
 *   await connector.close();
 */
export function attachConnector(
  host: ConnectorHost,
  opts: Omit<ConnectorOptions, "call" | "libraryName"> & { libraryName?: string } = {},
): Promise<ConnectorHandle> {
  const { libraryName, ...rest } = opts;
  return startConnector({
    ...rest,
    libraryName: libraryName ?? host.library.manifest.name ?? basename(host.library.root),
    call: (name, actor, input) =>
      host.registry.call(name, { actor: actor as `agent:${string}` }, input),
  });
}
