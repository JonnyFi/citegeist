import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { DEFAULT_HOOKS_PORT, EMBEDDING_MODEL_KEYS, type EmbeddingModelKey } from "@citegeist/ops";
import { writeFileAtomic } from "../fsutil.js";

/** What is stored on disk. `ai.apiKeys` is derived from the Keychain, so it is never persisted. */
export interface StoredSettings {
  ai: { routing: Record<string, string> };
  mailto?: string;
  /** Address for Unpaywall; the contact address when unset. */
  unpaywallEmail?: string;
  /** `tool` parameter for NCBI E-utilities; "citegeist" when unset. */
  ncbiTool?: string;
  uiLanguage: "de" | "en";
  /** `model` is a key of EMBEDDING_MODEL_KEYS; unset means the default (EmbeddingGemma). */
  semantic: { enabled: boolean; model?: EmbeddingModelKey };
  connector: { enabled: boolean; port: number };
  /** Port of the hooks listener and the address of the tunnel in front of it. */
  webhooks: { port: number; publicUrl?: string };
  /** A11: true restores the sandbox for chat agents. */
  chat: { isolated: boolean };
}

export const DEFAULT_SETTINGS: StoredSettings = {
  ai: { routing: { "*": "claude-code-cli" } },
  uiLanguage: "de",
  semantic: { enabled: false },
  connector: { enabled: false, port: 23119 },
  webhooks: { port: DEFAULT_HOOKS_PORT },
  chat: { isolated: false },
};

function validPort(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1024 && value <= 65535
    ? value
    : DEFAULT_SETTINGS.connector.port;
}

function validHooksPort(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1024 && value <= 65535
    ? value
    : DEFAULT_HOOKS_PORT;
}

function isModelKey(value: unknown): value is EmbeddingModelKey {
  return (EMBEDDING_MODEL_KEYS as readonly unknown[]).includes(value);
}

function sanitize(raw: unknown): StoredSettings {
  const v = (raw ?? {}) as {
    ai?: { routing?: unknown };
    mailto?: unknown;
    unpaywallEmail?: unknown;
    ncbiTool?: unknown;
    uiLanguage?: unknown;
    semantic?: { enabled?: unknown; model?: unknown };
    connector?: { enabled?: unknown; port?: unknown };
    webhooks?: { port?: unknown; publicUrl?: unknown };
    chat?: { isolated?: unknown };
  };
  const routing: Record<string, string> = {};
  if (v.ai?.routing && typeof v.ai.routing === "object") {
    for (const [task, id] of Object.entries(v.ai.routing)) {
      if (typeof id === "string" && id) routing[task] = id;
    }
  }
  return {
    ai: { routing: Object.keys(routing).length > 0 ? routing : { ...DEFAULT_SETTINGS.ai.routing } },
    ...(typeof v.mailto === "string" && v.mailto ? { mailto: v.mailto } : {}),
    ...(typeof v.unpaywallEmail === "string" && v.unpaywallEmail
      ? { unpaywallEmail: v.unpaywallEmail }
      : {}),
    ...(typeof v.ncbiTool === "string" && v.ncbiTool ? { ncbiTool: v.ncbiTool } : {}),
    uiLanguage: v.uiLanguage === "en" ? "en" : "de",
    semantic: {
      enabled: v.semantic?.enabled === true,
      ...(isModelKey(v.semantic?.model) ? { model: v.semantic.model } : {}),
    },
    connector: { enabled: v.connector?.enabled === true, port: validPort(v.connector?.port) },
    webhooks: {
      port: validHooksPort(v.webhooks?.port),
      ...(typeof v.webhooks?.publicUrl === "string" && v.webhooks.publicUrl
        ? { publicUrl: v.webhooks.publicUrl }
        : {}),
    },
    chat: { isolated: v.chat?.isolated === true },
  };
}

/**
 * Machine-local settings in one JSON file, shared by all libraries on this Mac (default:
 * `<local base>/settings.json`). A missing or broken file yields the defaults.
 */
export class SettingsStore {
  constructor(private readonly path: string) {}

  load(): StoredSettings {
    try {
      return sanitize(JSON.parse(readFileSync(this.path, "utf8")));
    } catch {
      return sanitize({});
    }
  }

  save(settings: StoredSettings): void {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileAtomic(this.path, `${JSON.stringify(sanitize(settings), null, 2)}\n`);
  }
}
