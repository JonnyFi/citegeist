import { type ZodType, z } from "zod";
import { aiErrors, snippet } from "./errors.js";

/** JSON Schema for the model, without the `$schema` marker some CLIs reject. */
export function toModelJsonSchema(schema: ZodType): Record<string, unknown> {
  const js = z.toJSONSchema(schema, { io: "output", unrepresentable: "any" }) as Record<
    string,
    unknown
  >;
  const { $schema: _drop, ...rest } = js;
  return rest;
}

/** Parses JSON that may be wrapped in a code fence or surrounded by prose. Returns undefined when nothing parses. */
export function parseJsonLoose(text: string): unknown {
  const t = text.trim();
  const candidates = [t];
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) candidates.push(fence[1].trim());
  const first = t.indexOf("{");
  const last = t.lastIndexOf("}");
  if (first >= 0 && last > first) candidates.push(t.slice(first, last + 1));
  for (const c of candidates) {
    try {
      return JSON.parse(c);
    } catch {
      // try the next candidate
    }
  }
  return undefined;
}

export interface StructuredOptions<T> {
  backend: string;
  task: string;
  schema: ZodType<T>;
  prompt: string;
  /** One model round trip. Returns parsed JSON or the raw text of the answer. Transport errors are thrown as CitegeistError. */
  attempt: (prompt: string) => Promise<unknown>;
  /** Total attempts, first try included. The contract is one retry, so 2. */
  maxAttempts?: number;
}

function issuesOf(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
}

/**
 * Runs `attempt`, validates against the schema, and on failure retries once with the validation
 * issues appended to the prompt. A second failure becomes an agent-ready AI_SCHEMA_INVALID error.
 */
export async function structured<T>(opts: StructuredOptions<T>): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 2;
  let prompt = opts.prompt;
  let lastIssues = "";
  for (let n = 1; n <= maxAttempts; n++) {
    const raw = await opts.attempt(prompt);
    const value = typeof raw === "string" ? parseJsonLoose(raw) : raw;
    if (value === undefined) {
      lastIssues = `output is not valid JSON: ${snippet(String(raw), 120)}`;
    } else {
      const parsed = opts.schema.safeParse(value);
      if (parsed.success) return parsed.data;
      lastIssues = issuesOf(parsed.error);
    }
    prompt = `${opts.prompt}\n\nYour previous answer was rejected: ${lastIssues}\nAnswer again with only JSON that matches the schema exactly.`;
  }
  throw aiErrors.schemaInvalid(opts.backend, opts.task, lastIssues, maxAttempts);
}
