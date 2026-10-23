import { z } from "zod";

/** Prefixed, ULID-based identifiers. The prefix tells humans and agents what an id points to. */
const ulid = "[0-9A-HJKMNP-TV-Z]{10,26}";
export const ItemId = z.string().regex(new RegExp(`^${ulid}$`), "item id must be a ULID");
export const CardId = z
  .string()
  .regex(new RegExp(`^c_${ulid}$`), "card id must look like c_<ULID>");
export const NoteId = z
  .string()
  .regex(new RegExp(`^n_${ulid}$`), "note id must look like n_<ULID>");
export const ProjectSlug = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,63}$/, "project slug: lowercase letters, digits, hyphens");
export const JobId = z.string().regex(new RegExp(`^j_${ulid}$`), "job id must look like j_<ULID>");

/** Stable citation key, also the item folder name and the Obsidian note name. */
export const Citekey = z
  .string()
  .regex(/^[a-z0-9][a-z0-9_-]{1,79}$/, "citekey: lowercase letters, digits, underscore, hyphen");

/** First 12 hex chars of the SHA-256 of a source file. Names files under sources/ and derived/. */
export const SourceHash = z.string().regex(/^[0-9a-f]{12}$/);
export const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);

/** BCP 47 language tag, e.g. "de", "en", "de-AT". */
export const Language = z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/);

/** Who did something: a human, a named agent, or the system itself. */
export const Actor = z.union([
  z.literal("human"),
  z.literal("system"),
  z
    .string()
    .regex(/^agent:[a-z0-9][a-z0-9._-]{0,63}$/, 'agent actor must look like "agent:<name>"'),
]);
export type Actor = z.infer<typeof Actor>;

export const Stamp = z.object({ at: z.iso.datetime(), by: Actor });
export type Stamp = z.infer<typeof Stamp>;

/** Origin of an AI-written text: which backend/model wrote it and when. */
export const ModelStamp = z.object({
  by: z.string().min(1),
  at: z.iso.datetime(),
  language: Language.optional(),
  checked: z.boolean().optional(),
});
export type ModelStamp = z.infer<typeof ModelStamp>;

/** Field-level provenance: field name to "<source>@<date>", e.g. "crossref@2026-10-23" or "human@2026-10-23". */
export const Provenance = z.record(
  z.string(),
  z.string().regex(/^[a-z0-9:._-]+@\d{4}-\d{2}-\d{2}$/),
);

/** Wiki link as written in frontmatter, e.g. "[[luhmann1984soziale]]" or "[[c_01JB...]]". */
export const WikiLink = z.string().regex(/^\[\[[^\]|#]+(#\^?[^\]|]+)?(\|[^\]]+)?\]\]$/);
