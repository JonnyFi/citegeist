import { z } from "zod";
import { Language, ProjectSlug, Stamp } from "./common.js";

/** What a card export includes for this project. Default: everything with provenance labels. */
export const ExportPolicy = z.object({
  paraphrase: z.enum(["ai", "own", "own-else-ai", "none"]).default("own-else-ai"),
  labelAi: z.boolean().default(false),
});

/** Frontmatter of projects/<slug>/project.md; the body is the project brief agents read. */
export const ProjectFrontmatter = z.object({
  slug: ProjectSlug,
  title: z.string().min(1),
  status: z.enum(["active", "paused", "done"]).default("active"),
  questions: z
    .array(z.object({ id: z.string().regex(/^q\d+$/), text: z.string().min(1) }))
    .default([]),
  /** CSL style id, e.g. "apa", "chicago-author-date", "deutsche-gesellschaft-fur-psychologie". */
  style: z.string().default("apa"),
  locale: z.string().default("de-DE"),
  /** Language of AI texts in this project; items may override it. */
  ai_language: Language.optional(),
  export: ExportPolicy.default({ paraphrase: "own-else-ai", labelAi: false }),
  created: Stamp,
});
export type ProjectFrontmatter = z.infer<typeof ProjectFrontmatter>;
