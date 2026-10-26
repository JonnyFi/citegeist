/**
 * The note a job carries when the AI router moved one of its tasks to another backend. It travels
 * in the `message` of the job, so every screen that shows job messages can show it; the UI turns
 * it into a sentence in its own language.
 */
export type FallbackReason = "limit" | "overloaded" | "auth";

export interface FallbackNote {
  /** Backend that failed or is paused. */
  from: string;
  /** Backend that took over. */
  to: string;
  reason: FallbackReason;
}

const PREFIX = "ai-fallback:";
const PATTERN = /^ai-fallback:([a-z0-9-]+):([a-z0-9-]+):(limit|overloaded|auth)$/;

export function formatFallbackNote(note: FallbackNote): string {
  return `${PREFIX}${note.from}:${note.to}:${note.reason}`;
}

/** Reads a job message back into a note; undefined for every other message. */
export function parseFallbackNote(message: string | undefined): FallbackNote | undefined {
  const m = message ? PATTERN.exec(message) : null;
  if (!m) return undefined;
  return { from: m[1] as string, to: m[2] as string, reason: m[3] as FallbackReason };
}
