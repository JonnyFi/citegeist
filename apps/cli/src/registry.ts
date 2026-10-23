import { createFixtureRegistry } from "@citegeist/mcp";
import { CONTRACTS, Registry } from "@citegeist/ops";
import { CitegeistError } from "@citegeist/schema";

/**
 * The one place where the CLI gets its Registry. W1.1 replaces the body with the real core, for
 * example `return createCoreRegistry({ library: env.CITEGEIST_LIBRARY })`. Everything else in the
 * CLI is generated from whatever Registry this returns.
 *
 * Until the core exists, CITEGEIST_FIXTURE=1 selects an in-memory registry with sample data.
 */
export function createRegistry(env: NodeJS.ProcessEnv = process.env): Registry {
  if (env.CITEGEIST_FIXTURE === "1") return createFixtureRegistry();
  return createUnwiredRegistry();
}

/** Lists every contract, so help and MCP tools exist, and fails each call with a clear fix. */
function createUnwiredRegistry(): Registry {
  const registry = new Registry();
  for (const contract of CONTRACTS) {
    registry.bind(contract, async () => {
      throw new CitegeistError({
        code: "CORE_NOT_WIRED",
        message: `The citegeist core is not linked into this build, so ${contract.name} cannot run.`,
        fix: "Set CITEGEIST_FIXTURE=1 to try the CLI against sample data.",
        recovery: "ask-human",
        sideEffects: "none",
      });
    });
  }
  return registry;
}
