import { Actor } from "@citegeist/schema";

/** The actor of an MCP call: "agent:<clientInfo.name>" when the client named itself, else "agent:mcp". */
export function actorFromClientName(name: string | undefined): Actor {
  const fallback = "agent:mcp";
  if (!name) return fallback;
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[^a-z0-9]+/, "")
    .replace(/-+$/, "")
    .slice(0, 64);
  const candidate = `agent:${slug}`;
  return slug && Actor.safeParse(candidate).success ? candidate : fallback;
}
