import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { AboutInfo } from "@citegeist/ui/bridge";
import { app } from "electron";
import { mt } from "../shared/text.js";

/** Set at build time by electron.vite.config.ts: the short commit of the build, or "". */
declare const __CITEGEIST_COMMIT__: string;

export const REPOSITORY_URL = "https://github.com/JonnyFi/citegeist";

/** The bundled NOTICE file: in Resources of the packaged app, in the repository root otherwise. */
export function noticePath(): string | undefined {
  const candidates = app.isPackaged
    ? [join(process.resourcesPath, "NOTICE")]
    : [resolve(import.meta.dirname, "../../../../NOTICE")];
  return candidates.find((c) => existsSync(c));
}

export function buildCommit(): string | undefined {
  const commit = typeof __CITEGEIST_COMMIT__ === "string" ? __CITEGEIST_COMMIT__ : "";
  return commit || undefined;
}

export interface AboutPaths {
  library?: string | undefined;
  /** Machine-local base: settings, index, Python environment. */
  dataDir: string;
  logFile: string;
}

export function aboutInfo(paths: AboutPaths): AboutInfo {
  const commit = buildCommit();
  const notice = noticePath();
  return {
    version: app.getVersion(),
    ...(commit ? { commit } : {}),
    license: "Apache-2.0",
    repositoryUrl: REPOSITORY_URL,
    ...(paths.library ? { libraryPath: paths.library } : {}),
    dataDir: paths.dataDir,
    logFile: paths.logFile,
    ...(notice ? { noticePath: notice } : {}),
  };
}

/** The lines of the About window, in the current language. */
export function aboutLines(info: AboutInfo): string[] {
  return [
    mt("about.version", { version: info.version }),
    ...(info.commit ? [mt("about.commit", { commit: info.commit })] : []),
    mt("about.license"),
    mt("about.repository", { url: info.repositoryUrl }),
    "",
    info.libraryPath ? mt("about.library", { path: info.libraryPath }) : mt("about.noLibrary"),
    mt("about.logs", { path: info.logFile.replace(/\/[^/]+$/, "") }),
    mt("about.data", { path: info.dataDir }),
  ];
}
