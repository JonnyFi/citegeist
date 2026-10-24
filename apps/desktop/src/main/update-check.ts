import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Update notice without electron-updater: Squirrel.Mac only applies updates to a signed app, and
 * citegeist is ad-hoc signed. The main process asks the GitHub releases API at most once a day,
 * compares the tag with app.getVersion() and tells the renderer. The action runs install.sh, the
 * same script a new user runs, in a Terminal window.
 */

export const RELEASES_API = "https://api.github.com/repos/JonnyFi/citegeist/releases/latest";
export const INSTALL_URL = "https://raw.githubusercontent.com/JonnyFi/citegeist/main/install.sh";
export const INSTALL_COMMAND = `curl -fsSL ${INSTALL_URL} | sh`;
export const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface UpdateInfo {
  /** Version without the leading `v`. */
  version: string;
  /** Page of the release, for the release notes. */
  url: string;
}

/** What survives a restart: when the API was asked last, and what it said. */
export interface UpdateState {
  lastCheck?: number;
  available?: UpdateInfo;
}

/** `v1.2.3` or `1.2.3` as numbers; undefined for anything else, such as `1.2.3-beta.1`. */
export function parseVersion(text: string): [number, number, number] | undefined {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(text.trim());
  if (!m) return undefined;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** True when `candidate` is a higher version than `current`. Unparseable versions never are. */
export function isNewer(candidate: string, current: string): boolean {
  const a = parseVersion(candidate);
  const b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

/** The release behind an API answer, or undefined for drafts, prereleases and anything odd. */
export function parseRelease(body: unknown): UpdateInfo | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const r = body as Record<string, unknown>;
  if (r.draft === true || r.prerelease === true) return undefined;
  if (typeof r.tag_name !== "string" || !parseVersion(r.tag_name)) return undefined;
  const version = r.tag_name.trim().replace(/^v/, "");
  const url = typeof r.html_url === "string" ? r.html_url : "";
  return { version, url };
}

export interface CheckOptions {
  /** `app.getVersion()`. */
  current: string;
  state: UpdateState;
  now?: number;
  fetch?: typeof fetch;
  api?: string;
}

/**
 * New state after a check. Within a day of the last request nothing is fetched and the stored
 * answer is judged against the current version again, so a notice disappears once the update is
 * installed. A failed request (offline, rate limit, no public release) leaves the old answer and
 * still counts as a check, so the API is not asked more than once a day either way.
 */
export async function checkForUpdate(opts: CheckOptions): Promise<UpdateState> {
  const now = opts.now ?? Date.now();
  const stored = opts.state.available;
  const keep = stored && isNewer(stored.version, opts.current) ? stored : undefined;
  const last = opts.state.lastCheck;
  if (last !== undefined && now >= last && now - last < CHECK_INTERVAL_MS) {
    return { lastCheck: last, ...(keep ? { available: keep } : {}) };
  }
  try {
    const res = await (opts.fetch ?? fetch)(opts.api ?? RELEASES_API, {
      headers: { accept: "application/vnd.github+json", "user-agent": "citegeist-update-check" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { lastCheck: now, ...(keep ? { available: keep } : {}) };
    const release = parseRelease(await res.json());
    const available = release && isNewer(release.version, opts.current) ? release : undefined;
    return { lastCheck: now, ...(available ? { available } : {}) };
  } catch {
    return { lastCheck: now, ...(keep ? { available: keep } : {}) };
  }
}

/**
 * Writes the `.command` file that the Terminal runs to install the update. A file created by
 * this process carries no quarantine attribute, so Terminal opens it without a prompt.
 */
export function writeInstallCommand(dir: string, url = INSTALL_URL): string {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "citegeist-update.command");
  writeFileSync(
    file,
    [
      "#!/bin/sh",
      'echo "Updating citegeist ..."',
      // download first and run second, so that a failed download is not mistaken for success
      'script="$(mktemp -t citegeist-install)"',
      `curl -fsSL ${url} -o "$script" && sh "$script"`,
      "status=$?",
      'rm -f "$script"',
      "echo",
      'if [ "$status" -eq 0 ]',
      'then echo "Done. You can close this window."',
      'else echo "The update failed, see above. You can close this window."',
      "fi",
      "",
    ].join("\n"),
  );
  chmodSync(file, 0o755);
  return file;
}
