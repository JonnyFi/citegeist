// MCP server over stdio with the planning operations bound to a real library. Spawned by
// planning.test.ts. The library and its project must exist before this starts.
//
//   CITEGEIST_TEST_LIBRARY  library folder
//   CITEGEIST_TEST_LOCAL    machine-local base for index and settings
import {
  bindCoreOperations,
  bindPlanningOperations,
  bindProjectContext,
  Library,
} from "@citegeist/core";
import { Registry } from "@citegeist/ops";
import { serveMcpStdio } from "../transports.js";

const root = process.env.CITEGEIST_TEST_LIBRARY;
const localBase = process.env.CITEGEIST_TEST_LOCAL;
if (!root || !localBase) {
  process.stderr.write("CITEGEIST_TEST_LIBRARY and CITEGEIST_TEST_LOCAL are required\n");
  process.exit(2);
}

const lib = await Library.open(root, { localBase, watch: false });
const registry = bindCoreOperations(new Registry(), lib);
bindPlanningOperations(registry, lib);
bindProjectContext(registry);
const handle = serveMcpStdio(registry, {
  onerror: (e) => process.stderr.write(`mcp error: ${e.message}\n`),
});
process.stdin.once("close", () => {
  void (async () => {
    await handle.close();
    await lib.close();
    process.exit(0);
  })();
});
