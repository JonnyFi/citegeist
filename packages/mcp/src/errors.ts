import { AgentError, CitegeistError } from "@citegeist/schema";
import { ZodError } from "zod";

/** Turns anything a handler can throw into an agent-ready error. */
export function toAgentError(err: unknown): AgentError {
  if (err instanceof CitegeistError) return err.detail;
  if (err instanceof ZodError) {
    const issues = err.issues
      .map((i) => `${i.path.length ? i.path.join(".") : "(input)"}: ${i.message}`)
      .join("; ");
    return AgentError.parse({
      code: "INVALID_INPUT",
      message: `The input does not match the operation schema (${issues}).`,
      fix: "Correct the listed fields and call the operation again.",
      recovery: "fix-and-retry",
      sideEffects: "none",
      context: { issues: err.issues.map((i) => ({ path: i.path, message: i.message })) },
    });
  }
  const message = err instanceof Error ? err.message : String(err);
  return AgentError.parse({
    code: "INTERNAL_ERROR",
    message: message || "Unexpected failure without a message.",
    fix: "Retry once; if it fails again, report this error to the citegeist maintainer.",
    recovery: "ask-human",
    sideEffects: "unknown",
  });
}

/** Plain-text form for MCP results and CLI stderr. The fix sits on the last line. */
export function formatAgentError(e: AgentError): string {
  const lines = [`${e.code}: ${e.message}`];
  lines.push(`Recovery: ${e.recovery}. Side effects: ${e.sideEffects}.`);
  if (Object.keys(e.context).length > 0) lines.push(`Context: ${JSON.stringify(e.context)}`);
  lines.push(`Fix: ${e.fix}`);
  return lines.join("\n");
}
