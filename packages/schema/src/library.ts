import { z } from "zod";
import { Language } from "./common.js";

export const LIBRARY_FORMAT_VERSION = 1;

/** citegeist.json at the library root. */
export const LibraryManifest = z.object({
  format: z.literal(LIBRARY_FORMAT_VERSION),
  id: z.string().min(8),
  name: z.string().min(1),
  defaults: z
    .object({
      ai_language: Language.default("de"),
      style: z.string().default("apa"),
      locale: z.string().default("de-DE"),
      citekey: z.string().default("auth.lower + year + shorttitle(1,0)"),
    })
    .default({
      ai_language: "de",
      style: "apa",
      locale: "de-DE",
      citekey: "auth.lower + year + shorttitle(1,0)",
    }),
});
export type LibraryManifest = z.infer<typeof LibraryManifest>;
