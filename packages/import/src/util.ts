import { randomBytes } from "node:crypto";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** A ULID, the id format of items. */
export function ulid(now = Date.now()): string {
  let time = "";
  let t = now;
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD.charAt(t % 32) + time;
    t = Math.floor(t / 32);
  }
  const bytes = randomBytes(16);
  let rand = "";
  for (let i = 0; i < 16; i++) rand += CROCKFORD.charAt((bytes[i] ?? 0) % 32);
  return time + rand;
}

/** Lower-case, accent-free text with single spaces, for comparing titles and names. */
export function normalizeText(s: string): string {
  return s
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** The year at the start of a date value such as 1984, "1984-03" or "2021-03-04". */
export function yearOf(issued: string | number | undefined): string | undefined {
  if (issued === undefined) return undefined;
  return /^-?(\d{1,4})/.exec(String(issued))?.[1];
}

/** Lower-case ASCII slug with hyphens, at most `max` characters. */
export function slug(input: string, max = 64): string {
  return normalizeText(input)
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
}

const CITEKEY = /^[a-z0-9][a-z0-9_-]{1,79}$/;

/**
 * The key from a source file as a valid citekey: the key itself, or its lower-case form
 * ("Smith2020" becomes "smith2020"). Undefined when neither is valid.
 */
export function usableCitekey(key: unknown): string | undefined {
  if (typeof key !== "string") return undefined;
  const k = key.trim();
  return [k, k.toLowerCase()].find((c) => CITEKEY.test(c));
}

/** Today's date as the provenance tag uses it. */
export function isoDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
