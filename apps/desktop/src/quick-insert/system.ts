import { execFile } from "node:child_process";

/** Runs a command and returns stdout. Injected in tests. */
export type Exec = (file: string, args: readonly string[]) => Promise<string>;

export const run: Exec = (file, args) =>
  new Promise((resolve, reject) => {
    execFile(file, [...args], { timeout: 4000 }, (err, stdout) =>
      err ? reject(err) : resolve(stdout),
    );
  });

/** Pulls the bundle id out of `lsappinfo info -only bundleid` output: `"CFBundleIdentifier"="com.apple.Safari"`. */
export function parseBundleId(output: string): string | undefined {
  const id = /"CFBundleIdentifier"\s*=\s*"([^"]+)"/.exec(output)?.[1];
  return id && /^[A-Za-z0-9.-]+$/.test(id) ? id : undefined;
}

/** `lsappinfo front` prints the ASN of the frontmost app, e.g. `ASN:0x0-0x1b01b:`. */
export function parseAsn(output: string): string | undefined {
  return /ASN:0x[0-9a-f]+-0x[0-9a-f]+:?/i.exec(output)?.[0]?.replace(/:$/, "");
}

/**
 * What the palette needs from the operating system around it: which app has focus, how to give
 * focus back, and how to type Cmd+V into it. Only macOS has all three. None of the macOS calls
 * needs a permission except the keystroke, which needs Accessibility.
 */
export interface FrontApp {
  /** Bundle id of the frontmost app, or undefined when unknown. Call before showing the palette. */
  capture(): Promise<string | undefined>;
  activate(bundleId: string): Promise<void>;
  /** Types Cmd+V into the frontmost app. */
  paste(): Promise<void>;
  readonly supportsPaste: boolean;
}

export function macFrontApp(exec: Exec = run): FrontApp {
  return {
    supportsPaste: true,
    async capture() {
      try {
        const asn = parseAsn(await exec("/usr/bin/lsappinfo", ["front"]));
        if (!asn) return undefined;
        return parseBundleId(await exec("/usr/bin/lsappinfo", ["info", "-only", "bundleid", asn]));
      } catch {
        return undefined;
      }
    },
    async activate(bundleId) {
      if (!/^[A-Za-z0-9.-]+$/.test(bundleId)) return;
      await exec("/usr/bin/open", ["-b", bundleId]);
    },
    async paste() {
      await exec("/usr/bin/osascript", [
        "-e",
        'tell application "System Events" to keystroke "v" using command down',
      ]);
    },
  };
}

/** Other platforms: hotkey and clipboard work, focus handling is left to the window manager. */
export const noFrontApp: FrontApp = {
  supportsPaste: false,
  capture: async () => undefined,
  activate: async () => {},
  paste: async () => {},
};
