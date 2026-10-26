import {
  CardId,
  Citekey,
  JobId,
  OutlineNodeId,
  PlanSlug,
  ProjectSlug,
  TextSlug,
} from "@citegeist/schema";
import { z } from "zod";
import { defineContract, type OperationContract } from "../registry.js";

// Chat sessions (W3.3). The agent chat in the sidebar and research jobs share one session model.
// A turn streams through the core's change events: every update to a session emits a change on the
// virtual path `chat/<session>`, and the client refetches `chat.get`.

export const ChatSessionId = z
  .string()
  .regex(/^ch_[0-9A-HJKMNP-TV-Z]{10,26}$/, "chat session id must look like ch_<ULID>");
export type ChatSessionId = z.infer<typeof ChatSessionId>;

/** Virtual change path under which a session announces new content. */
export const chatChangePath = (session: string): string => `chat/${session}`;

/** The passage the user marked when they opened the chat from the reader. */
export const ChatSelection = z.object({
  citekey: Citekey,
  text: z.string().min(1).max(8000),
  /** Printed page label of the passage. */
  page: z.string().optional(),
  card: CardId.optional(),
});
export type ChatSelection = z.infer<typeof ChatSelection>;

/**
 * What the agent is told about the screen: the project, the open plan and outline node, the open
 * source and a marked passage.
 */
export const ChatContext = z.object({
  project: ProjectSlug.optional(),
  plan: PlanSlug.optional(),
  node: OutlineNodeId.optional(),
  /** The text open in the Texte tab of the project. */
  text: TextSlug.optional(),
  item: Citekey.optional(),
  selection: ChatSelection.optional(),
});
export type ChatContext = z.infer<typeof ChatContext>;

export const ChatSessionKind = z.enum(["chat", "research"]);

export const ChatSessionSummary = z.object({
  id: ChatSessionId,
  title: z.string(),
  /** Backend id such as `claude-code`, `codex` or `cursor`. */
  backend: z.string(),
  kind: ChatSessionKind,
  project: ProjectSlug.optional(),
  item: Citekey.optional(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  running: z.boolean(),
  turns: z.number().int().nonnegative(),
  /** The research job that owns this session. */
  job: JobId.optional(),
  /** Library-relative path of the saved transcript. */
  saved: z.string().optional(),
});
export type ChatSessionSummary = z.infer<typeof ChatSessionSummary>;

const EntryBase = {
  /** Position in the session, stable. */
  id: z.number().int().nonnegative(),
  turn: z.number().int().positive(),
  at: z.iso.datetime(),
};

export const ChatToolStatus = z.enum(["pending", "running", "done", "failed"]);

export const ChatEntry = z.discriminatedUnion("type", [
  z.object({
    ...EntryBase,
    type: z.literal("user"),
    text: z.string(),
    context: ChatContext.optional(),
  }),
  z.object({
    ...EntryBase,
    type: z.literal("assistant"),
    /** Markdown with wiki-link citations such as `[[c_01JB...|Luhmann 1984, S. 31]]`. */
    text: z.string(),
  }),
  z.object({
    ...EntryBase,
    type: z.literal("tool"),
    callId: z.string(),
    title: z.string(),
    kind: z.string(),
    status: ChatToolStatus,
    /** Name of the citegeist MCP tool when the agent called one, e.g. `add_item`. */
    tool: z.string().optional(),
    /** One line about the arguments or the result. */
    detail: z.string().optional(),
  }),
  z.object({
    ...EntryBase,
    type: z.literal("notice"),
    level: z.enum(["info", "error"]),
    text: z.string(),
    fix: z.string().optional(),
  }),
]);
export type ChatEntry = z.infer<typeof ChatEntry>;

export const ChatEdit = z.object({
  /** Library-relative path with forward slashes. */
  path: z.string(),
  change: z.enum(["created", "modified", "deleted"]),
});
export type ChatEdit = z.infer<typeof ChatEdit>;

export const ChatTurn = z.object({
  turn: z.number().int().positive(),
  status: z.enum(["running", "done", "cancelled", "failed"]),
  startedAt: z.iso.datetime(),
  endedAt: z.iso.datetime().optional(),
  stopReason: z.string().optional(),
  /** Files the agent changed during this turn. */
  edits: z.array(ChatEdit).default([]),
  reverted: z
    .object({ at: z.iso.datetime(), restored: z.number().int(), conflicts: z.number().int() })
    .optional(),
});
export type ChatTurn = z.infer<typeof ChatTurn>;

const Ok = z.object({ ok: z.literal(true) });

export const chatBackends = defineContract({
  name: "chat.backends",
  summary: "Agents the chat can talk to, with their status",
  access: "read",
  input: z.object({}),
  output: z.object({
    default: z.string(),
    backends: z.array(
      z.object({
        id: z.string(),
        label: z.string(),
        available: z.boolean(),
        detail: z.string().optional(),
      }),
    ),
  }),
});

export const chatStart = defineContract({
  name: "chat.start",
  summary: "Open a chat session with an agent, optionally anchored to a project, item or passage",
  access: "write",
  input: ChatContext.extend({ backend: z.string().optional(), title: z.string().optional() }),
  output: z.object({ session: ChatSessionSummary }),
});

export const chatSend = defineContract({
  name: "chat.send",
  summary: "Send a message; the agent answers asynchronously and streams through change events",
  access: "write",
  input: z.object({
    session: ChatSessionId,
    message: z.string().min(1),
    /** Replaces the session context for this and later turns, e.g. after the user opened another source. */
    context: ChatContext.optional(),
  }),
  output: z.object({ turn: z.number().int().positive() }),
});

export const chatCancel = defineContract({
  name: "chat.cancel",
  summary: "Stop the running turn of a session",
  access: "write",
  input: z.object({ session: ChatSessionId }),
  output: Ok,
});

export const chatList = defineContract({
  name: "chat.list",
  summary: "Chat and research sessions, newest first",
  access: "read",
  input: z.object({
    project: ProjectSlug.optional(),
    kind: ChatSessionKind.optional(),
    limit: z.number().int().positive().max(200).default(50),
  }),
  output: z.object({ sessions: z.array(ChatSessionSummary) }),
});

export const chatGet = defineContract({
  name: "chat.get",
  summary: "Transcript of a session with the file edits of every turn",
  access: "read",
  input: z.object({ session: ChatSessionId }),
  output: z.object({
    session: ChatSessionSummary,
    context: ChatContext,
    entries: z.array(ChatEntry),
    turns: z.array(ChatTurn),
  }),
});

export const chatRevertTurn = defineContract({
  name: "chat.revertTurn",
  summary:
    "Undo all file edits of one agent turn; files the user changed in between are merged, conflicts stay untouched",
  access: "write",
  input: z.object({ session: ChatSessionId, turn: z.number().int().positive() }),
  output: z.object({
    restored: z.array(z.string()),
    conflicts: z.array(z.object({ path: z.string(), reason: z.string() })),
  }),
});

export const chatSave = defineContract({
  name: "chat.save",
  summary: "Save the transcript of a session as chats/<date>-<slug>.md in the library",
  access: "write",
  input: z.object({ session: ChatSessionId }),
  output: z.object({ path: z.string() }),
});

export const CHAT_CONTRACTS: readonly OperationContract[] = [
  chatBackends,
  chatStart,
  chatSend,
  chatCancel,
  chatList,
  chatGet,
  chatRevertTurn,
  chatSave,
];
