import { createHash } from "node:crypto";

export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Normalizes line breaks to "\n". */
export function normalizeNewlines(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

/**
 * quote_sha256 of a card: SHA-256 of the verbatim quote after the blockquote prefix is removed
 * and line breaks are normalized to "\n" (see docs/spec/library-format.md).
 */
export function quoteSha256(quote: string): string {
  return sha256Hex(normalizeNewlines(quote));
}
