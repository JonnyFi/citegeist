import { readFileSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";

export interface Settings {
  lastLibrary?: string;
}

const file = () => join(app.getPath("userData"), "settings.json");

export function loadSettings(): Settings {
  try {
    const v = JSON.parse(readFileSync(file(), "utf8")) as Settings;
    return typeof v.lastLibrary === "string" ? { lastLibrary: v.lastLibrary } : {};
  } catch {
    return {};
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  const { mkdir, writeFile } = await import("node:fs/promises");
  await mkdir(app.getPath("userData"), { recursive: true });
  await writeFile(file(), `${JSON.stringify(settings, null, 2)}\n`);
}
