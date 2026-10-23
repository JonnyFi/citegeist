import { oneLine } from "./util.js";

function text(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
}

/** The citekey in the result of `add_item` (JSON in the text block or in structuredContent). */
export function extractCitekey(output: unknown): string | undefined {
  const m = /"citekey"\s*:\s*"([a-z0-9][a-z0-9_-]{1,79})"/.exec(text(output));
  return m?.[1];
}

/** One readable line about a tool call, shown under the tool entry in the chat. */
export function toolDetail(tool: string | undefined, input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const o = input as Record<string, unknown>;
  const str = (k: string) => (typeof o[k] === "string" ? (o[k] as string) : undefined);
  switch (tool) {
    case "add_item":
      return str("identifier")
        ? `${str("identifier")}${str("why") ? ` (${str("why")})` : ""}`
        : undefined;
    case "search":
      return str("q");
    case "read_document":
      return [str("citekey"), str("pages") ? `p. ${str("pages")}` : undefined]
        .filter(Boolean)
        .join(", ");
    case "get_item":
      return str("citekey");
    case "create_note":
      return str("title");
    default:
      for (const k of ["file_path", "path", "url", "query", "identifier", "title"]) {
        const v = str(k);
        if (v) return oneLine(v, 120);
      }
      return undefined;
  }
}
