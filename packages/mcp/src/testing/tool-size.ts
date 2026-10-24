// Measures what an agent pays for the tool listing: `pnpm --filter @citegeist/mcp tool-size`.
// Starts the MCP server over stdio, lists the tools like a client does and prints the size of
// the listing, per tool and in total. There is no Claude tokenizer in the repo, so tokens are
// estimated from characters: compact JSON of schemas runs at about 3 to 4 characters per token.
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const script = fileURLToPath(new URL("./fixture-stdio.ts", import.meta.url));
const client = new Client({ name: "tool-size", version: "1.0.0" });
await client.connect(
  new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", script],
    env: { ...(process.env as Record<string, string>), CITEGEIST_MCP_SCOPE: "write" },
    stderr: "inherit",
  }),
);
const { tools } = await client.listTools();
const instructions = client.getInstructions() ?? "";
await client.close();

const LOW = 4;
const HIGH = 3;
const rows = tools.map((t) => {
  // What the model sees in its tool list: name, description and input schema.
  const model = JSON.stringify({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema,
  });
  return { name: t.name, model: model.length, full: JSON.stringify(t).length };
});
const sum = (key: "model" | "full") => rows.reduce((n, r) => n + r[key], 0);
const range = (chars: number) => `${Math.round(chars / LOW)} to ${Math.round(chars / HIGH)}`;

for (const r of rows.sort((a, b) => b.model - a.model)) {
  console.log(
    `${r.name.padEnd(16)} ${String(r.model).padStart(6)} chars  ~${Math.round(r.model / 3.5)} tokens`,
  );
}
console.log(`\ntools: ${tools.length}`);
console.log(
  `model-facing listing (name, description, input schema): ${sum("model")} chars, about ${range(sum("model"))} tokens`,
);
console.log(
  `full listing incl. output schemas and annotations: ${sum("full")} chars, about ${range(sum("full"))} tokens`,
);
console.log(
  `server instructions: ${instructions.length} chars, about ${range(instructions.length)} tokens`,
);
