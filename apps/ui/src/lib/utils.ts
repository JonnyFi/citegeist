import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** What a failed call tells: the message, a fix hint, and the error code with its context. */
export interface DescribedError {
  message: string;
  fix?: string;
  /** Stable code such as `PDF_ENGINE_MISSING`; screens map it to a message in the UI language. */
  code?: string;
  context?: Record<string, unknown>;
}

/** Message and optional fix hint from whatever a failed call threw. */
export function describeError(err: unknown, fallback = "Something went wrong."): DescribedError {
  if (err && typeof err === "object") {
    const data = (err as { data?: unknown }).data;
    if (data && typeof data === "object" && "message" in data) {
      const d = data as {
        message: string;
        fix?: string;
        code?: unknown;
        context?: unknown;
      };
      return {
        message: d.message,
        ...(d.fix ? { fix: d.fix } : {}),
        ...(typeof d.code === "string" ? { code: d.code } : {}),
        ...(d.context && typeof d.context === "object"
          ? { context: d.context as Record<string, unknown> }
          : {}),
      };
    }
    if ("message" in err && typeof (err as { message: unknown }).message === "string") {
      return { message: (err as { message: string }).message };
    }
  }
  return { message: fallback };
}
