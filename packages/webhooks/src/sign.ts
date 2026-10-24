import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

// Signing scheme, shared by inbound and outbound requests:
//
//   x-citegeist-id         unique id of the delivery (a UUID is fine)
//   x-citegeist-timestamp  Unix time in seconds
//   x-citegeist-signature  v1=<hex>  where <hex> = HMAC-SHA256(secret, `${id}.${timestamp}.${rawBody}`)
//
// During a secret rotation the sender may list several signatures, separated by spaces.

export const ID_HEADER = "x-citegeist-id";
export const TIMESTAMP_HEADER = "x-citegeist-timestamp";
export const SIGNATURE_HEADER = "x-citegeist-signature";
/** How far a timestamp may be from our clock, in seconds. */
export const DEFAULT_TOLERANCE_SECONDS = 300;

export type SignedHeaders = {
  [ID_HEADER]: string;
  [TIMESTAMP_HEADER]: string;
  [SIGNATURE_HEADER]: string;
};

export function computeSignature(
  secret: string,
  id: string,
  timestamp: string,
  body: string | Buffer,
): string {
  return createHmac("sha256", secret).update(`${id}.${timestamp}.`).update(body).digest("hex");
}

export function signRequest(
  secret: string,
  body: string,
  opts: { id?: string; now?: Date } = {},
): SignedHeaders {
  const id = opts.id ?? randomUUID();
  const timestamp = String(Math.floor((opts.now ?? new Date()).getTime() / 1000));
  return {
    [ID_HEADER]: id,
    [TIMESTAMP_HEADER]: timestamp,
    [SIGNATURE_HEADER]: `v1=${computeSignature(secret, id, timestamp, body)}`,
  };
}

export type VerifyFailure =
  | "missing-headers"
  | "bad-timestamp"
  | "stale-timestamp"
  | "bad-signature";

export type VerifyResult = { ok: true; id: string } | { ok: false; reason: VerifyFailure };

export interface VerifyInput {
  id: string | undefined;
  timestamp: string | undefined;
  signature: string | undefined;
  /** The body exactly as received. Parsing and re-serialising would change the bytes. */
  rawBody: Buffer;
  /** Secrets that are valid now: the current one, plus the previous one during a rotation. */
  secrets: readonly string[];
  now?: Date;
  toleranceSeconds?: number;
}

function equalStrings(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Checks timestamp window and signature. Replay detection by id is the receiver's job. */
export function verifyRequest(input: VerifyInput): VerifyResult {
  const { id, timestamp, signature } = input;
  if (!id || !timestamp || !signature) return { ok: false, reason: "missing-headers" };
  if (!/^\d{1,12}$/.test(timestamp)) return { ok: false, reason: "bad-timestamp" };
  const now = Math.floor((input.now ?? new Date()).getTime() / 1000);
  const tolerance = input.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  if (Math.abs(now - Number(timestamp)) > tolerance)
    return { ok: false, reason: "stale-timestamp" };

  const given = signature
    .split(/[\s,]+/)
    .filter((part) => part.startsWith("v1="))
    .map((part) => part.slice(3));
  // Every secret and every given signature is compared, so timing does not reveal which matched.
  let matched = false;
  for (const secret of input.secrets) {
    const expected = computeSignature(secret, id, timestamp, input.rawBody);
    for (const candidate of given) if (equalStrings(candidate, expected)) matched = true;
  }
  return matched ? { ok: true, id } : { ok: false, reason: "bad-signature" };
}

/** A fresh secret: 32 random bytes, URL-safe. */
export function generateSecret(): string {
  return `whsec_${randomBytes(32).toString("base64url")}`;
}

/** Remembers delivery ids for a while, so a captured request cannot be sent again. */
export class ReplayGuard {
  private readonly seen = new Map<string, number>();

  constructor(
    private readonly ttlMs = (DEFAULT_TOLERANCE_SECONDS * 2 + 60) * 1000,
    private readonly max = 10_000,
  ) {}

  /** True the first time a key is seen, false for a repeat inside the window. */
  claim(key: string, nowMs: number): boolean {
    for (const [k, until] of this.seen) {
      if (until > nowMs) break; // insertion order is expiry order
      this.seen.delete(k);
    }
    if (this.seen.has(key)) return false;
    if (this.seen.size >= this.max) {
      const oldest = this.seen.keys().next().value;
      if (oldest !== undefined) this.seen.delete(oldest);
    }
    this.seen.set(key, nowMs + this.ttlMs);
    return true;
  }
}
