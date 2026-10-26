import { readFileSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";
import type { UpdateState } from "./update-check.js";

export interface Settings {
  lastLibrary?: string;
  /** The language the window showed last, so menus and dialogs start in it. */
  language?: "de" | "en";
  /** Result of the last check for a newer release. */
  update?: UpdateState;
}

const file = () => join(app.getPath("userData"), "settings.json");

function updateState(v: unknown): UpdateState | undefined {
  if (typeof v !== "object" || v === null) return undefined;
  const u = v as Record<string, unknown>;
  const out: UpdateState = {};
  if (typeof u.lastCheck === "number") out.lastCheck = u.lastCheck;
  const a = u.available as Record<string, unknown> | undefined;
  if (a && typeof a.version === "string" && typeof a.url === "string") {
    out.available = { version: a.version, url: a.url };
  }
  return out;
}

export function loadSettings(): Settings {
  try {
    const v = JSON.parse(readFileSync(file(), "utf8")) as Record<string, unknown>;
    const update = updateState(v.update);
    return {
      ...(typeof v.lastLibrary === "string" ? { lastLibrary: v.lastLibrary } : {}),
      ...(v.language === "de" || v.language === "en" ? { language: v.language } : {}),
      ...(update ? { update } : {}),
    };
  } catch {
    return {};
  }
}

/** Merges `patch` into the stored settings, so one writer does not erase the other's keys. */
export async function saveSettings(patch: Settings): Promise<void> {
  const { mkdir, writeFile } = await import("node:fs/promises");
  await mkdir(app.getPath("userData"), { recursive: true });
  await writeFile(file(), `${JSON.stringify({ ...loadSettings(), ...patch }, null, 2)}\n`);
}
