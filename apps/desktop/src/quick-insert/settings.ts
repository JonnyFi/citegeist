import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { mt } from "../shared/text.js";

export interface QuickInsertSettings {
  enabled: boolean;
  /** Electron accelerator, e.g. "CommandOrControl+Shift+K". */
  accelerator: string;
}

export const DEFAULT_ACCELERATOR = "CommandOrControl+Shift+K";
export const DEFAULT_SETTINGS: QuickInsertSettings = {
  enabled: true,
  accelerator: DEFAULT_ACCELERATOR,
};

const MODIFIERS = new Map<string, string>([
  ["command", "Command"],
  ["cmd", "Command"],
  ["control", "Control"],
  ["ctrl", "Control"],
  ["commandorcontrol", "CommandOrControl"],
  ["cmdorctrl", "CommandOrControl"],
  ["alt", "Alt"],
  ["option", "Alt"],
  ["shift", "Shift"],
  ["super", "Super"],
  ["meta", "Super"],
]);

const NAMED_KEYS = new Map<string, string>(
  [
    "Space",
    "Tab",
    "Backspace",
    "Delete",
    "Insert",
    "Return",
    "Enter",
    "Up",
    "Down",
    "Left",
    "Right",
    "Home",
    "End",
    "PageUp",
    "PageDown",
    "Escape",
    "Esc",
    "Plus",
  ].map((k) => [k.toLowerCase(), k]),
);

const PUNCTUATION = new Set([..."`-=[]\\;',./"]);

/** Canonical key name for the last part of an accelerator, or undefined when it is not a key. */
function canonicalKey(part: string): string | undefined {
  if (/^[a-z0-9]$/i.test(part)) return part.toUpperCase();
  if (/^f([1-9]|1\d|2[0-4])$/i.test(part)) return part.toUpperCase();
  if (part.length === 1 && PUNCTUATION.has(part)) return part;
  return NAMED_KEYS.get(part.toLowerCase());
}

export type AcceleratorCheck = { ok: true; accelerator: string } | { ok: false; error: string };

/**
 * Validates an Electron accelerator and writes it in canonical form. A global hotkey needs at
 * least one modifier (a bare letter would steal typing from every app) and exactly one key.
 */
export function checkAccelerator(input: string): AcceleratorCheck {
  const trimmed = input.trim();
  // "Shift++" means Shift and the plus key.
  const plus = trimmed.endsWith("++");
  const named = (plus ? trimmed.slice(0, -2) : trimmed)
    .split("+")
    .map((p) => p.trim())
    .filter((p) => p !== "");
  const parts = plus ? [...named, "Plus"] : named;
  if (parts.length < 2) {
    return { ok: false, error: mt("quickInsert.needsModifier") };
  }
  const key = canonicalKey(parts[parts.length - 1] as string);
  if (!key) {
    return {
      ok: false,
      error: mt("quickInsert.badKey", { key: parts[parts.length - 1] as string }),
    };
  }
  const mods: string[] = [];
  for (const p of parts.slice(0, -1)) {
    const mod = MODIFIERS.get(p.toLowerCase());
    if (!mod) return { ok: false, error: mt("quickInsert.badModifier", { key: p }) };
    if (!mods.includes(mod)) mods.push(mod);
  }
  return { ok: true, accelerator: [...mods, key].join("+") };
}

const FILE = "quick-insert.json";

/** Reads the settings from `dir` (Electron's userData). Anything unreadable falls back to defaults. */
export function loadQuickInsertSettings(dir: string): QuickInsertSettings {
  try {
    const raw = JSON.parse(readFileSync(join(dir, FILE), "utf8")) as Partial<QuickInsertSettings>;
    const checked =
      typeof raw.accelerator === "string" ? checkAccelerator(raw.accelerator) : undefined;
    return {
      enabled: typeof raw.enabled === "boolean" ? raw.enabled : DEFAULT_SETTINGS.enabled,
      accelerator: checked?.ok ? checked.accelerator : DEFAULT_ACCELERATOR,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveQuickInsertSettings(
  dir: string,
  settings: QuickInsertSettings,
): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, FILE), `${JSON.stringify(settings, null, 2)}\n`);
}
