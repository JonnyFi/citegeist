import { CitegeistError } from "@citegeist/schema";

/**
 * What a remote connector may ask `items.add` to open. `items.add` also takes local file paths
 * and any http(s) URL, which is right for the user and for local agents but not for a sender on
 * the internet: a signed request must not make the core read a file of this Mac or call a service
 * on its network. These two checks run before the call.
 */

const FILE_EXT = /\.(pdf|html?|epub)$/i;
const PRIVATE_V4: Array<[number, number]> = [
  [0x7f000000, 8], // 127.0.0.0/8 loopback
  [0x0a000000, 8], // 10.0.0.0/8
  [0xac100000, 12], // 172.16.0.0/12
  [0xc0a80000, 16], // 192.168.0.0/16
  [0xa9fe0000, 16], // 169.254.0.0/16 link-local, cloud metadata
  [0x64400000, 10], // 100.64.0.0/10 carrier-grade NAT, Tailscale
  [0x00000000, 8], // 0.0.0.0/8
];

function v4ToInt(host: string): number | undefined {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return undefined;
  const parts = m.slice(1).map(Number);
  if (parts.some((p) => p > 255)) return undefined;
  return (
    ((parts[0] ?? 0) * 2 ** 24 +
      (parts[1] ?? 0) * 2 ** 16 +
      (parts[2] ?? 0) * 256 +
      (parts[3] ?? 0)) >>>
    0
  );
}

/** True for a host that is this Mac or a private network: localhost, .local, private IP ranges. */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".lan")) return true;
  // A name without a dot is a LAN host name.
  if (!host.includes(".") && !host.startsWith("[")) return true;
  if (host.startsWith("[")) {
    const v6 = host.slice(1, -1);
    if (v6 === "::1" || v6 === "::") return true;
    if (/^f[cd][0-9a-f]{2}:/.test(v6) || /^fe[89ab][0-9a-f]:/.test(v6)) return true;
    const mapped = /^::ffff:(.+)$/.exec(v6);
    if (mapped?.[1]) {
      const dotted = mapped[1];
      if (dotted.includes(".")) return isPrivateHost(dotted);
      return true; // ::ffff:7f00:1 and friends: refuse every hex-mapped address
    }
    return false;
  }
  const n = v4ToInt(host);
  if (n === undefined) return false;
  return PRIVATE_V4.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (n & mask) >>> 0 === base;
  });
}

function refused(identifier: string, why: string): CitegeistError {
  return new CitegeistError({
    code: "WEBHOOK_INPUT_REFUSED",
    message: `a webhook may not add ${why}: ${identifier.slice(0, 80)}`,
    fix: "Send a DOI, an arXiv id, an ISBN, a PMID or the https URL of a public page.",
    recovery: "fix-and-retry",
  });
}

/**
 * Throws when `identifier` names a local file or a URL on this Mac or a private network. DNS names
 * that resolve to a private address and redirects are not checked here.
 */
export function assertRemoteSafe(identifier: string): void {
  const raw = identifier.trim();
  if (/^https?:\/\//i.test(raw)) {
    let host: string;
    try {
      host = new URL(raw).hostname;
    } catch {
      throw refused(raw, "a malformed URL");
    }
    if (isPrivateHost(host)) throw refused(raw, "an address on this Mac or a private network");
    return;
  }
  // A URL of another scheme (file:, ftp:, gopher:, ...) is never an identifier a connector needs.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) throw refused(raw, "a URL that is not http or https");
  if (raw.startsWith("@") || raw.includes("\n")) return; // a BibTeX entry
  const doiLike = /^(doi:)?10\.\d{4,9}\//i.test(raw);
  const pathLike = /^(\/|~|\.{1,2}\/|\.\.?$)/.test(raw) || (!doiLike && FILE_EXT.test(raw));
  if (pathLike) throw refused(raw, "a local file");
}
