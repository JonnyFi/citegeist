import type { AgentError } from "@citegeist/schema";

/** Exit codes of `cg`. Each failure class has its own, so a shell agent can branch on `$?`. */
export const EXIT = {
  ok: 0,
  internal: 1,
  usage: 2,
  notFound: 3,
  forbidden: 4,
  retry: 5,
  doFirst: 6,
  askHuman: 7,
  fixAndRetry: 8,
} as const;

export const EXIT_HELP = `Exit codes:
  0  success
  1  internal error
  2  usage error or invalid input
  3  not found
  4  not allowed for this actor
  5  temporary failure, retry
  6  a prerequisite is missing, do that first
  7  needs a human decision
  8  fixable by correcting the call
Errors go to stderr; with --json they are one JSON object {"error": {...}}.`;

export function exitCodeFor(e: AgentError): number {
  if (e.code === "INVALID_INPUT" || e.code === "USAGE_ERROR" || e.code === "UNKNOWN_OPERATION") {
    return EXIT.usage;
  }
  if (e.code === "INTERNAL_ERROR") return EXIT.internal;
  if (e.code.includes("NOT_FOUND")) return EXIT.notFound;
  if (e.code.includes("FORBIDDEN")) return EXIT.forbidden;
  switch (e.recovery) {
    case "retry":
      return EXIT.retry;
    case "do-first":
      return EXIT.doFirst;
    case "ask-human":
      return EXIT.askHuman;
    case "fix-and-retry":
      return EXIT.fixAndRetry;
  }
}
