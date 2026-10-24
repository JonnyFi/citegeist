import { Citekey, JobId, NoteType, ProjectSlug } from "@citegeist/schema";
import { z } from "zod";

// What an external agent may send to /hooks/<name>. Every body is JSON with an `event` field.

/** A paper: a bare identifier or URL, or an object with a reason of its own. */
export const PaperRef = z.union([
  z.string().min(1),
  z
    .object({
      identifier: z.string().min(1).optional(),
      url: z.string().min(1).optional(),
      why: z.string().optional(),
    })
    .refine((p) => p.identifier !== undefined || p.url !== undefined, {
      message: "a paper needs an identifier or a url",
    }),
]);
export type PaperRef = z.infer<typeof PaperRef>;

/** A source of a note: a citekey already in the library, an identifier or a plain URL. */
export const SourceRef = z.union([
  z.string().min(1),
  z.object({ citekey: Citekey }),
  z.object({ identifier: z.string().min(1) }),
  z.object({ url: z.string().min(1), title: z.string().optional() }),
]);
export type SourceRef = z.infer<typeof SourceRef>;

const Target = z.enum(["inbox", "library"]).default("inbox");
const Papers = z.array(PaperRef).max(50);

export const PingPayload = z.object({ event: z.literal("ping") }).loose();

export const PapersAddPayload = z.object({
  event: z.literal("papers.add"),
  papers: Papers.min(1),
  /** Reason shown with every paper that has none of its own. */
  why: z.string().optional(),
  /** D7: the inbox unless the agent says "library". */
  target: Target,
  projects: z.array(ProjectSlug).default([]),
  tags: z.array(z.string()).default([]),
});

export const NoteAddPayload = z.object({
  event: z.literal("note.add"),
  title: z.string().min(1),
  text: z.string().min(1),
  type: NoteType.default("permanent"),
  sources: z.array(SourceRef).max(50).default([]),
  projects: z.array(ProjectSlug).default([]),
});

/** The callback of an outbound research task. `task` is the id citegeist sent with the task. */
export const TaskResultPayload = z.object({
  event: z.literal("task.result"),
  task: JobId,
  status: z.enum(["succeeded", "failed"]).default("succeeded"),
  summary: z.string().optional(),
  error: z.string().optional(),
  papers: Papers.default([]),
  target: Target,
});

export const InboundPayload = z.discriminatedUnion("event", [
  PingPayload,
  PapersAddPayload,
  NoteAddPayload,
  TaskResultPayload,
]);
export type InboundPayload = z.infer<typeof InboundPayload>;
export type PapersAddPayload = z.infer<typeof PapersAddPayload>;
export type NoteAddPayload = z.infer<typeof NoteAddPayload>;
export type TaskResultPayload = z.infer<typeof TaskResultPayload>;

/** The task citegeist sends to an outbound connector. */
export interface TaskRequestPayload {
  event: "task.request";
  /** Send this back as `task` in the callback. */
  task: string;
  prompt: string;
  project?: { slug: string; title: string; briefExcerpt: string };
  callback: { url: string; event: "task.result" };
}
