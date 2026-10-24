import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { CitegeistError } from "@citegeist/schema";

/**
 * The address check for downloads that an agent or a job starts (M5). `items.add` takes any
 * http(s) URL, which is right for the human. For everyone else the core must not become a proxy
 * into this Mac (127.0.0.1, the services behind it) or into the local network and the cloud
 * metadata address 169.254.169.254.
 */

/** Redirects a guarded download follows, each one checked again. */
export const MAX_REDIRECTS = 5;

/** [network, prefix length] of the IPv4 ranges that are not the public internet. */
const PRIVATE_V4: ReadonlyArray<readonly [number, number]> = [
  [0x00000000, 8], // 0.0.0.0/8 "this" network
  [0x0a000000, 8], // 10.0.0.0/8
  [0x64400000, 10], // 100.64.0.0/10 carrier-grade NAT, Tailscale
  [0x7f000000, 8], // 127.0.0.0/8 loopback
  [0xa9fe0000, 16], // 169.254.0.0/16 link-local, cloud metadata
  [0xac100000, 12], // 172.16.0.0/12
  [0xc0000000, 24], // 192.0.0.0/24 IETF protocol assignments
  [0xc0a80000, 16], // 192.168.0.0/16
  [0xc6120000, 15], // 198.18.0.0/15 benchmarking
  [0xe0000000, 4], // 224.0.0.0/4 multicast
  [0xf0000000, 4], // 240.0.0.0/4 reserved, includes the broadcast address
];

function v4ToInt(ip: string): number | undefined {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return undefined;
  const parts = m.slice(1).map(Number);
  if (parts.some((p) => p > 255)) return undefined;
  const [a = 0, b = 0, c = 0, d = 0] = parts;
  return (a * 2 ** 24 + b * 2 ** 16 + c * 256 + d) >>> 0;
}

function privateV4(n: number): boolean {
  return PRIVATE_V4.some(([base, bits]) => {
    const mask = (0xffffffff << (32 - bits)) >>> 0;
    return (n & mask) >>> 0 === base;
  });
}

/** The eight 16-bit groups of an IPv6 address, with "::" expanded and a dotted tail converted. */
function v6Groups(ip: string): number[] | undefined {
  let text = ip.toLowerCase().split("%")[0] ?? "";
  const tail = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(text)?.[1];
  if (tail) {
    const n = v4ToInt(tail);
    if (n === undefined) return undefined;
    text = `${text.slice(0, -tail.length)}${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return undefined;
  const parse = (part: string) => (part === "" ? [] : part.split(":"));
  const head = parse(halves[0] ?? "");
  const rest = halves.length === 2 ? parse(halves[1] ?? "") : [];
  if (halves.length === 1 && head.length !== 8) return undefined;
  const fill = 8 - head.length - rest.length;
  if (fill < 0 || (halves.length === 2 && fill < 1)) return undefined;
  const groups = [...head, ...Array<string>(halves.length === 2 ? fill : 0).fill("0"), ...rest];
  const out = groups.map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? Number.parseInt(g, 16) : Number.NaN));
  return out.length === 8 && out.every((g) => !Number.isNaN(g)) ? out : undefined;
}

/** True for an IP address (v4 or v6, no brackets) that is not on the public internet. */
export function isPrivateAddress(address: string): boolean {
  const kind = isIP(address);
  if (kind === 4) {
    const n = v4ToInt(address);
    return n === undefined || privateV4(n);
  }
  if (kind === 6) {
    const g = v6Groups(address);
    if (!g) return true;
    const [g0 = 0, g1 = 0, g2 = 0, g3 = 0, g4 = 0, g5 = 0, g6 = 0, g7 = 0] = g;
    const v4 = ((g6 << 16) | g7) >>> 0;
    if (g.every((x) => x === 0)) return true; // ::
    if (g.slice(0, 7).every((x) => x === 0) && g7 === 1) return true; // ::1
    if ((g0 & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
    if ((g0 & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
    if ((g0 & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local
    if ((g0 & 0xff00) === 0xff00) return true; // ff00::/8 multicast
    if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && (g5 === 0xffff || g5 === 0)) {
      return privateV4(v4); // ::ffff:a.b.c.d mapped, ::a.b.c.d compatible
    }
    if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) {
      return privateV4(v4); // 64:ff9b::/96 NAT64
    }
    if (g0 === 0x2002) return privateV4(((g1 << 16) | g2) >>> 0); // 2002::/16 6to4
    return false;
  }
  return true; // not an address at all
}

/** True for a host name that is this Mac or a private network, whatever it resolves to. */
export function isPrivateHostName(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  const bare = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  if (isIP(bare) !== 0) return isPrivateAddress(bare);
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".lan")) return true;
  // A name without a dot is a LAN host name.
  return !host.includes(".");
}

/** Every address of a host name, from the system resolver. */
export async function lookupAddresses(host: string): Promise<string[]> {
  const found = await lookup(host, { all: true, verbatim: true });
  return found.map((f) => f.address);
}

function notPublic(url: string, why: string): CitegeistError {
  return new CitegeistError({
    code: "URL_NOT_PUBLIC",
    message: `${url.slice(0, 120)} ${why}, so only the user may fetch it`,
    fix: "Add the work by DOI, arXiv id or the URL of a public page. For an address on the local network, ask the user to add it in the app.",
    recovery: "ask-human",
    context: { url: url.slice(0, 200) },
  });
}

/**
 * Throws URL_NOT_PUBLIC unless `url` is http(s) and its host is a public server. Names are
 * resolved and every address must be public. A resolver that fails lets the fetch fail with its
 * own error. `resolve` undefined skips the lookup (only the name and literal addresses count).
 */
export async function refusePrivateUrl(
  url: string,
  resolve: ((host: string) => Promise<string[]>) | undefined,
): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw notPublic(url, "is not a valid address");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw notPublic(url, "is not an http or https address");
  }
  if (isPrivateHostName(parsed.hostname)) {
    throw notPublic(url, "points to this Mac or a private network");
  }
  const literal = isIP(parsed.hostname.replace(/^\[|\]$/g, "")) !== 0;
  if (literal || !resolve) return;
  let addresses: string[];
  try {
    addresses = await resolve(parsed.hostname);
  } catch {
    return;
  }
  if (addresses.some(isPrivateAddress)) {
    throw notPublic(url, "resolves to an address on this Mac or a private network");
  }
}
