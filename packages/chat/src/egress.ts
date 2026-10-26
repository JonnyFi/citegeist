import { isScholarlyUrl, normalizeUrl, urlsIn } from "@citegeist/ops";

/**
 * The web access of a research job (W5.1, Agents Rule of Two, L9 in the internal security audit). The agent
 * reads untrusted pages and the library, so it must not be able to call an address that it
 * composed itself: such an address can carry library content to a server of the attacker. A
 * fetch is allowed when its address sits on a scholarly host (`SCHOLARLY_HOSTS`) or when an
 * earlier web search of the session returned exactly this address.
 */

export type WebTool = "search" | "fetch";

/** Whether a tool call is the web search or the web fetch of an agent, by name or by arguments. */
export function webToolOf(call: {
  name?: string | null | undefined;
  title?: string | null | undefined;
  kind?: string | null | undefined;
  rawInput?: unknown;
  _meta?: { [key: string]: unknown } | null | undefined;
}): WebTool | undefined {
  const claude = (call._meta?.claudeCode as { toolName?: unknown } | undefined)?.toolName;
  const names = [claude, call.name].filter((n): n is string => typeof n === "string");
  for (const n of names) {
    if (/^WebSearch$/i.test(n) || /web[_-]?search/i.test(n)) return "search";
    if (/^WebFetch$/i.test(n) || /web[_-]?fetch/i.test(n)) return "fetch";
  }
  const input = call.rawInput;
  if (input && typeof input === "object") {
    const o = input as Record<string, unknown>;
    if (typeof o.url === "string") return "fetch";
    if (typeof o.query === "string" && call.kind === "fetch") return "search";
  }
  if (call.kind === "fetch" && /^(web\s*search|search\b)/i.test(call.title ?? "")) return "search";
  return undefined;
}

/** Every string inside a value of unknown shape, so addresses can be found without JSON escapes. */
function stringsOf(value: unknown, out: string[] = [], depth = 0): string[] {
  if (depth > 8) return out;
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const v of value) stringsOf(v, out, depth + 1);
  else if (value && typeof value === "object") {
    for (const v of Object.values(value)) stringsOf(v, out, depth + 1);
  }
  return out;
}

/** Normalized addresses in a tool result or a text. */
export function addressesIn(...values: unknown[]): string[] {
  const out: string[] = [];
  for (const text of values.flatMap((v) => stringsOf(v))) {
    for (const url of urlsIn(text)) {
      const n = normalizeUrl(url);
      if (n) out.push(n);
    }
  }
  return out;
}

export type FetchVerdict = { allow: true } | { allow: false; reason: string };

/** The rule for the web access of a research job. `seen` holds normalized addresses. */
export function researchFetch(
  call: Parameters<typeof webToolOf>[0],
  seen: ReadonlySet<string> | undefined,
): FetchVerdict {
  const tool = webToolOf(call);
  const input = (call.rawInput && typeof call.rawInput === "object" ? call.rawInput : {}) as {
    url?: unknown;
  };
  if (tool === "search") return { allow: true };
  if (typeof input.url === "string") {
    const n = normalizeUrl(input.url);
    if (isScholarlyUrl(input.url) || (n !== undefined && seen?.has(n))) return { allow: true };
    return {
      allow: false,
      reason:
        "A research job opens only addresses that a web search returned or that sit on a scholarly host such as doi.org or arxiv.org. Search for the page and use the address from the result.",
    };
  }
  return {
    allow: false,
    reason: "A research job may search the web and open addresses from search results.",
  };
}
