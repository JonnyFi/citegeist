import { existsSync, readFileSync } from "node:fs";
import { writeFileAtomic } from "../fsutil.js";
import type { Library } from "../library.js";
import { type AgentsMdOptions, renderAgentsMd, renderClaudeMd } from "./render.js";

export { type AgentsMdOptions, renderAgentsMd, renderClaudeMd };

/**
 * Writes AGENTS.md (always current, overwritten when it differs) and CLAUDE.md (only when it does
 * not exist, so a hand-written CLAUDE.md survives) into the library root.
 */
export function writeAgentsMd(lib: Pick<Library, "paths" | "manifest">): {
  agentsMd: "written" | "unchanged";
  claudeMd: "written" | "unchanged";
} {
  const agents = renderAgentsMd({ name: lib.manifest.name });
  const current = existsSync(lib.paths.agentsMd) ? readFileSync(lib.paths.agentsMd, "utf8") : "";
  const agentsMd = current === agents ? "unchanged" : "written";
  if (agentsMd === "written") writeFileAtomic(lib.paths.agentsMd, agents);
  const claudeMd = existsSync(lib.paths.claudeMd) ? "unchanged" : "written";
  if (claudeMd === "written") writeFileAtomic(lib.paths.claudeMd, renderClaudeMd());
  return { agentsMd, claudeMd };
}
