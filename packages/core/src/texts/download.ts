import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { CitegeistError } from "@citegeist/schema";

/** How a tool names itself in the errors of its download. */
export interface ToolNames {
  /** `Pandoc`, `Typst`. */
  label: string;
  /** Prefix of the error codes: `PANDOC` gives `PANDOC_DOWNLOAD_FAILED`. */
  prefix: string;
  /** The Homebrew formula, for the manual route in a fix. */
  brew: string;
  /** Source file of the pin, named in the checksum fix. */
  pinFile: string;
}

export function setupError(
  code: string,
  message: string,
  fix: string,
  recovery: "do-first" | "fix-and-retry",
): CitegeistError {
  // A job error carries only code and message, so the fix travels inside the message too.
  return new CitegeistError({
    code,
    message: `${message} ${fix}`,
    fix,
    recovery,
    sideEffects: "none",
  });
}

export interface DownloadSpec {
  url: string;
  sha256: string;
  sizeMb: number;
  version: string;
}

export interface Progress {
  progress(value: number, message?: string): void;
  signal?: AbortSignal | undefined;
}

/**
 * Streams `spec.url` to `dest` and compares the sha256 of the bytes with the pin. A mismatch
 * throws `<PREFIX>_CHECKSUM`, so nothing from a download that does not match is ever unpacked.
 */
export async function downloadChecked(
  ctx: Progress,
  doFetch: (url: string, init?: RequestInit) => Promise<Response>,
  spec: DownloadSpec,
  dest: string,
  names: ToolNames,
): Promise<void> {
  const { label, prefix, brew, pinFile } = names;
  ctx.progress(0.02, `Downloading ${label} ${spec.version} (about ${spec.sizeMb} MB)`);
  let response: Response;
  try {
    response = await doFetch(spec.url, { ...(ctx.signal ? { signal: ctx.signal } : {}) });
  } catch (err) {
    throw setupError(
      `${prefix}_DOWNLOAD_FAILED`,
      `The download of ${label} failed: ${err instanceof Error ? err.message : String(err)}.`,
      `Check the network connection and run the ${label} setup again.`,
      "fix-and-retry",
    );
  }
  if (!response.ok || !response.body) {
    throw setupError(
      `${prefix}_DOWNLOAD_FAILED`,
      `GitHub answered ${response.status} for ${spec.url}.`,
      `Run the ${label} setup again later, or install ${label} yourself (\`brew install ${brew}\`).`,
      "fix-and-retry",
    );
  }
  const hash = createHash("sha256");
  const total = Number(response.headers.get("content-length")) || spec.sizeMb * 1024 * 1024;
  let received = 0;
  const body = Readable.fromWeb(response.body as import("node:stream/web").ReadableStream);
  body.on("data", (chunk: Buffer) => {
    hash.update(chunk);
    received += chunk.length;
    ctx.progress(0.02 + 0.8 * Math.min(received / total, 1));
  });
  await pipeline(body, createWriteStream(dest));
  const digest = hash.digest("hex");
  if (digest !== spec.sha256) {
    throw setupError(
      `${prefix}_CHECKSUM`,
      `The download has sha256 ${digest}, expected ${spec.sha256}.`,
      `Run the ${label} setup again. If it fails again, the pinned release changed and the pin in packages/core/src/texts/${pinFile} needs an update.`,
      "fix-and-retry",
    );
  }
}
