// Starts the MCP server over stdio against the fixture registry. Spawned by the stdio test.
import { createFixtureRegistry } from "../fixture.js";
import { serveMcpStdio } from "../transports.js";

const scope = process.env.CITEGEIST_MCP_SCOPE === "read" ? "read" : "write";
serveMcpStdio(createFixtureRegistry(), {
  scope,
  onerror: (e) => process.stderr.write(`mcp error: ${e.message}\n`),
});
