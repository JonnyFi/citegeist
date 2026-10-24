import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { WebhookKind } from "@citegeist/ops";

/**
 * Where secrets live. `Keychain` from @citegeist/core fits this shape, so the macOS Keychain is
 * the real store and `InMemoryKeychain` serves tests.
 */
export interface SecretStore {
  get(account: string): Promise<string | undefined>;
  set(account: string, secret: string): Promise<void>;
  delete(account: string): Promise<void>;
  has(account: string): Promise<boolean>;
}

/** Keychain account of a connector's current and previous secret. */
export const secretAccount = (name: string): string => `webhook-${name}`;
export const previousSecretAccount = (name: string): string => `webhook-${name}-prev`;
/** Keychain account of the value of the outbound auth header. */
export const authValueAccount = (name: string): string => `webhook-${name}-auth`;
/** Keychain account of the bearer token for the MCP endpoint. */
export const mcpTokenAccount = (name: string): string => `webhook-${name}-mcp`;
/** Keychain account of the inbound bearer token. */
export const inboundTokenAccount = (name: string): string => `webhook-${name}-inbound`;

export interface ConnectorRecord {
  name: string;
  kind: WebhookKind;
  url?: string;
  /** Name of the outbound auth header. Its value is in the Keychain, never in this file. */
  authHeader?: string;
  /** The agent may use the MCP endpoint with its token (in the Keychain). Absent means no access. */
  mcpScope?: "read" | "write";
  createdAt: string;
  /** ISO time until which the previous secret is accepted. */
  previousSecretUntil?: string;
}

interface Stored {
  version: 1;
  connectors: ConnectorRecord[];
}

/**
 * The connector list as a small JSON file in the machine-local folder. It holds names, kinds and
 * URLs; secrets never touch the file.
 */
export class ConnectorStore {
  private connectors: ConnectorRecord[] = [];
  private loaded = false;

  constructor(private readonly path: string) {}

  static inDir(dir: string): ConnectorStore {
    return new ConnectorStore(join(dir, "webhooks.json"));
  }

  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const parsed = JSON.parse(readFileSync(this.path, "utf8")) as Partial<Stored>;
      this.connectors = Array.isArray(parsed.connectors) ? parsed.connectors : [];
    } catch {
      this.connectors = [];
    }
  }

  private save(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(
      tmp,
      `${JSON.stringify({ version: 1, connectors: this.connectors }, null, 2)}\n`,
      {
        mode: 0o600,
      },
    );
    renameSync(tmp, this.path);
  }

  list(): ConnectorRecord[] {
    this.load();
    return this.connectors.map((c) => ({ ...c }));
  }

  get(name: string): ConnectorRecord | undefined {
    this.load();
    const found = this.connectors.find((c) => c.name === name);
    return found ? { ...found } : undefined;
  }

  put(record: ConnectorRecord): void {
    this.load();
    const index = this.connectors.findIndex((c) => c.name === record.name);
    if (index >= 0) this.connectors[index] = record;
    else this.connectors.push(record);
    this.save();
  }

  remove(name: string): boolean {
    this.load();
    const before = this.connectors.length;
    this.connectors = this.connectors.filter((c) => c.name !== name);
    if (this.connectors.length === before) return false;
    this.save();
    return true;
  }
}
