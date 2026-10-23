import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** Message and optional fix hint from whatever a failed call threw. */
export function describeError(err: unknown): { message: string; fix?: string } {
  if (err && typeof err === "object") {
    const data = (err as { data?: unknown }).data;
    if (data && typeof data === "object" && "message" in data) {
      const d = data as { message: string; fix?: string };
      return d.fix ? { message: d.message, fix: d.fix } : { message: d.message };
    }
    if ("message" in err && typeof (err as { message: unknown }).message === "string") {
      return { message: (err as { message: string }).message };
    }
  }
  return { message: "Something went wrong." };
}
