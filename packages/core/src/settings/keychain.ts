import { nodeRunner, type ProcessRunner } from "@citegeist/ai";
import { CitegeistError } from "@citegeist/schema";

/** Where API keys live. Keys never go to disk, to settings.json or to logs. */
export interface Keychain {
  get(provider: string): Promise<string | undefined>;
  set(provider: string, key: string): Promise<void>;
  delete(provider: string): Promise<void>;
  /** Presence check that does not read the secret. */
  has(provider: string): Promise<boolean>;
}

/** Keychain for tests and for platforms without the `security` tool. Lives in process memory only. */
export class InMemoryKeychain implements Keychain {
  private readonly keys = new Map<string, string>();

  async get(provider: string): Promise<string | undefined> {
    return this.keys.get(provider);
  }
  async set(provider: string, key: string): Promise<void> {
    this.keys.set(provider, key);
  }
  async delete(provider: string): Promise<void> {
    this.keys.delete(provider);
  }
  async has(provider: string): Promise<boolean> {
    return this.keys.has(provider);
  }
}

export const KEYCHAIN_SERVICE = "citegeist";
/** `security` exits with 44 when an item does not exist. */
const NOT_FOUND = 44;

function failed(action: string, detail: string): CitegeistError {
  return new CitegeistError({
    code: "KEYCHAIN_FAILED",
    message: `The macOS Keychain refused to ${action}: ${detail.trim().slice(0, 200) || "no details"}`,
    fix: "Unlock the login keychain in Keychain Access, allow citegeist if macOS asks, then retry.",
    recovery: "ask-human",
    context: { action },
  });
}

/**
 * macOS Keychain through the `security` CLI. A key is written through `security -i` on stdin and
 * as a hex string (`-X`), so it appears in no process argument list and needs no shell quoting.
 */
export class MacKeychain implements Keychain {
  private readonly runner: ProcessRunner;
  private readonly service: string;

  constructor(opts: { runner?: ProcessRunner; service?: string } = {}) {
    this.runner = opts.runner ?? nodeRunner;
    this.service = opts.service ?? KEYCHAIN_SERVICE;
  }

  private run(args: string[], stdin?: string) {
    return this.runner({
      command: "security",
      args,
      cwd: "/",
      env: { PATH: process.env.PATH, HOME: process.env.HOME },
      ...(stdin === undefined ? {} : { stdin }),
      timeoutMs: 15_000,
    });
  }

  async get(provider: string): Promise<string | undefined> {
    const r = await this.run(["find-generic-password", "-s", this.service, "-a", provider, "-w"]);
    if (r.exitCode === NOT_FOUND) return undefined;
    if (r.exitCode !== 0) throw failed("read the key", r.stderr);
    return r.stdout.replace(/\r?\n$/, "");
  }

  async set(provider: string, key: string): Promise<void> {
    // The provider lands in a `security -i` command line, so it must be a plain identifier.
    if (!/^[a-z0-9][a-z0-9_-]*$/i.test(provider)) throw failed("store the key", "invalid provider");
    const hex = Buffer.from(key, "utf8").toString("hex");
    const line = `add-generic-password -U -s ${this.service} -a ${provider} -X ${hex}\n`;
    const r = await this.run(["-i"], line);
    // `security -i` reports a failed command on stderr and can still exit 0.
    if (r.exitCode !== 0 || /security: |error|could not|denied/i.test(r.stderr)) {
      throw failed("store the key", r.stderr.split(hex).join("<key>"));
    }
  }

  async delete(provider: string): Promise<void> {
    const r = await this.run(["delete-generic-password", "-s", this.service, "-a", provider]);
    if (r.exitCode !== 0 && r.exitCode !== NOT_FOUND) throw failed("delete the key", r.stderr);
  }

  async has(provider: string): Promise<boolean> {
    const r = await this.run(["find-generic-password", "-s", this.service, "-a", provider]);
    if (r.exitCode === NOT_FOUND) return false;
    if (r.exitCode !== 0) throw failed("look up the key", r.stderr);
    return true;
  }
}
