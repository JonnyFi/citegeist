import { z } from "zod";

/**
 * Agent-ready error, following gstack's contract: what failed with which values, a safe fix on
 * the first or last line, recovery semantics, a stable code. Never contains secrets.
 */
export const AgentError = z.object({
  code: z.string().regex(/^[A-Z][A-Z0-9_]+$/),
  message: z.string().min(1),
  fix: z.string().min(1),
  recovery: z.enum(["retry", "fix-and-retry", "do-first", "ask-human"]),
  sideEffects: z.enum(["none", "partial", "complete", "unknown"]).default("none"),
  context: z.record(z.string(), z.unknown()).default({}),
});
export type AgentError = z.infer<typeof AgentError>;

export class CitegeistError extends Error {
  readonly detail: AgentError;
  constructor(detail: z.input<typeof AgentError>) {
    const parsed = AgentError.parse(detail);
    super(`${parsed.code}: ${parsed.message}`);
    this.name = "CitegeistError";
    this.detail = parsed;
  }
}
