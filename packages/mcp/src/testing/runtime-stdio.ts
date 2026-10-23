// Starts the MCP server over stdio against a real library and the real runtime. Spawned by the
// write-tool tests. The library must exist (Library.init) before this starts.
//
//   CITEGEIST_TEST_LIBRARY  library folder
//   CITEGEIST_TEST_LOCAL    machine-local base for index and settings
//   CITEGEIST_MCP_SCOPE     "read" or "write" (default)
import { fileURLToPath } from "node:url";
import { cannedAiBackend, createRuntime, createStubWorker, Library } from "@citegeist/core";
import { createReplayFetch, createResolver } from "@citegeist/metadata";
import { serveMcpStdio } from "../transports.js";

const root = process.env.CITEGEIST_TEST_LIBRARY;
const localBase = process.env.CITEGEIST_TEST_LOCAL;
if (!root || !localBase) {
  process.stderr.write("CITEGEIST_TEST_LIBRARY and CITEGEIST_TEST_LOCAL are required\n");
  process.exit(2);
}

const lib = await Library.open(root, { localBase, watch: true });
const metadataDir = fileURLToPath(new URL("../../../../fixtures/metadata/http", import.meta.url));
const runtime = createRuntime(lib, {
  worker: createStubWorker(),
  resolver: createResolver({
    config: { mailto: "tester@example.invalid" },
    fetch: createReplayFetch(metadataDir),
    sleep: async () => {},
  }),
  ai: { backends: [cannedAiBackend()] },
});
const handle = serveMcpStdio(runtime.registry, {
  scope: process.env.CITEGEIST_MCP_SCOPE === "read" ? "read" : "write",
  onerror: (e) => process.stderr.write(`mcp error: ${e.message}\n`),
});
process.stdin.once("close", () => {
  void (async () => {
    await handle.close();
    await runtime.close();
    await lib.close();
    process.exit(0);
  })();
});
