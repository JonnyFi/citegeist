export const PROTOCOL = "citegeist";

const CITEKEY = /^[a-z0-9][a-z0-9_-]{1,79}$/;
const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;

/**
 * Maps a citegeist:// link to a renderer route, or undefined for anything unknown or malformed.
 *
 *   citegeist://library | inbox | projects | settings
 *   citegeist://item/<citekey>
 *   citegeist://project/<slug>
 *   citegeist://search?q=<text>
 */
export function deepLinkToPath(raw: string): string | undefined {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  if (url.protocol !== `${PROTOCOL}:`) return undefined;
  const parts = [url.hostname, ...url.pathname.split("/").filter(Boolean)].filter(Boolean);
  const kind = parts[0]?.toLowerCase();
  const arg = parts[1];

  switch (kind) {
    case "library":
      return "/";
    case "inbox":
      return "/inbox";
    case "projects":
      return "/projects";
    case "settings":
      return "/settings";
    case "item":
      return arg && CITEKEY.test(arg) ? `/items/${arg}` : undefined;
    case "project":
      return arg && SLUG.test(arg) ? `/projects/${arg}` : undefined;
    case "search": {
      const q = url.searchParams.get("q")?.trim();
      return q ? `/search?q=${encodeURIComponent(q)}` : "/search";
    }
    default:
      return undefined;
  }
}

/** The citegeist:// link in a process argument list (second instance on Windows and Linux). */
export function findDeepLink(argv: readonly string[]): string | undefined {
  return argv.find((a) => a.startsWith(`${PROTOCOL}://`));
}
