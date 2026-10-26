import type { Translator, Vars } from "../i18n";
import type { DescribedError } from "../lib/utils";

/**
 * The message of a failed export or setup in the UI language. The core words its errors in
 * English; the code stays the same, so the catalog (`texts.error.<CODE>` and `.fix`) can say it
 * in German. A code without an entry keeps the core's own message.
 */
export function localizedError(
  tr: Translator,
  error: Pick<DescribedError, "message" | "fix" | "code" | "context">,
): { message: string; fix?: string } {
  const key = `texts.error.${error.code ?? ""}`;
  if (!error.code || !tr.has(key)) {
    return { message: error.message, ...(error.fix ? { fix: error.fix } : {}) };
  }
  const vars: Vars = {};
  for (const [name, value] of Object.entries(error.context ?? {})) {
    if (typeof value === "string" || typeof value === "number") vars[name] = value;
  }
  const fix = `${key}.fix`;
  return {
    message: tr.t(key, vars),
    ...(tr.has(fix) ? { fix: tr.t(fix, vars) } : {}),
  };
}
