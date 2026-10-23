import {
  type ChatContext,
  type ChatEntry,
  type ChatSessionSummary,
  type ChatTurn,
  chatBackends,
  chatCancel,
  chatChangePath,
  chatGet,
  chatList,
  chatRevertTurn,
  chatSave,
  chatSend,
  chatStart,
  jobsList,
  type Registry,
  researchStart,
} from "@citegeist/ops";
import { ItemFrontmatter, type Job } from "@citegeist/schema";
import type { CoreEvent } from "../lib/core";
import type { MockData } from "../mock/fixtures";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
function id(prefix: string, length = 26): string {
  let out = "";
  for (let i = 0; i < length; i++) out += CROCKFORD[Math.floor(Math.random() * CROCKFORD.length)];
  return `${prefix}${out}`;
}

type NewEntry = ChatEntry extends infer E
  ? E extends ChatEntry
    ? Omit<E, "id" | "turn" | "at">
    : never
  : never;

interface MockSession {
  summary: Omit<ChatSessionSummary, "running" | "turns">;
  context: ChatContext;
  entries: ChatEntry[];
  turns: ChatTurn[];
  timers: Set<ReturnType<typeof setTimeout>>;
  running: boolean;
}

interface MockChat {
  sessions: Map<string, MockSession>;
  jobs: Job[];
}

const STORES = new WeakMap<MockData, MockChat>();
const WRITES = /(notier|festhalt|schreib|formulier|ausformulier|write|note down|draft)/i;

/**
 * The agent chat and research jobs against fixture data. A scripted agent answers after short
 * steps: a search, an answer with citations (one of them invented), and for requests to write
 * something a recorded file edit that can be undone.
 */
export function bindChatMock(
  registry: Registry,
  data: MockData,
  emit: (event: CoreEvent) => void,
  options: { stepMs?: number } = {},
): Registry {
  const step = options.stepMs ?? 300;
  let store = STORES.get(data);
  if (!store) {
    store = { sessions: new Map(), jobs: [] };
    STORES.set(data, store);
  }
  const chat = store;
  const changed = (path: string) => emit({ type: "change", path, external: false });
  const now = () => new Date().toISOString();

  const summaryOf = (s: MockSession): ChatSessionSummary => ({
    ...s.summary,
    running: s.running,
    turns: s.turns.length,
  });
  const find = (sessionId: string): MockSession => {
    const s = chat.sessions.get(sessionId);
    if (!s) throw new Error(`CHAT_SESSION_NOT_FOUND: no chat session with id ${sessionId}`);
    return s;
  };
  const later = (s: MockSession, ms: number, fn: () => void) => {
    const timer = setTimeout(() => {
      s.timers.delete(timer);
      fn();
    }, ms);
    s.timers.add(timer);
  };

  function runTurn(s: MockSession, turn: ChatTurn, message: string) {
    const push = (e: NewEntry) => {
      s.entries.push({ ...e, id: s.entries.length, turn: turn.turn, at: now() } as ChatEntry);
      changed(chatChangePath(s.summary.id));
    };
    const card = data.cards[0];
    const citekey = card?.frontmatter.item ?? "luhmann1984soziale";
    const topic = message.split(/\s+/).slice(0, 4).join(" ");
    const writes = WRITES.test(message);

    push({
      type: "tool",
      callId: `call-${turn.turn}-1`,
      title: "search",
      kind: "other",
      status: "running",
      tool: "search",
      detail: topic,
    });
    later(s, step, () => {
      const call = s.entries.find((e) => e.type === "tool" && e.callId === `call-${turn.turn}-1`);
      if (call?.type === "tool") call.status = "done";
      changed(chatChangePath(s.summary.id));
      const chunks = [
        `Zu „${topic}“ finde ich in `,
        `[[${citekey}|Luhmann 1984]] eine passende Stelle`,
        card
          ? ` ([[${card.frontmatter.id}|Luhmann 1984, S. ${card.frontmatter.locator?.start ?? "31"}]]).`
          : ".",
        " Eine zweite Quelle, [[erfunden2020|Erfunden 2020]], kann ich in deiner Bibliothek nicht belegen.",
      ];
      let at = 0;
      const next = () => {
        const text = chunks[at];
        if (text === undefined) return finish();
        at += 1;
        const last = s.entries[s.entries.length - 1];
        if (last?.type === "assistant" && last.turn === turn.turn) last.text += text;
        else push({ type: "assistant", text });
        changed(chatChangePath(s.summary.id));
        later(s, step, next);
      };
      next();
    });

    function finish() {
      if (writes) {
        push({
          type: "tool",
          callId: `call-${turn.turn}-2`,
          title: "create_note",
          kind: "other",
          status: "done",
          tool: "create_note",
          detail: topic,
        });
        turn.edits = [{ path: `notes/chat-${turn.turn}.md`, change: "created" }];
      }
      turn.status = "done";
      turn.stopReason = "end_turn";
      turn.endedAt = now();
      s.running = false;
      s.summary.updatedAt = turn.endedAt;
      changed(chatChangePath(s.summary.id));
    }
  }

  // Research jobs ------------------------------------------------------------------------------
  const FINDS = [
    [
      "rieder2020engines",
      "Engines for Order",
      "Rieder",
      "Gerrit",
      2020,
      "Search engines as ordering devices, close to your question on ranking.",
    ],
    [
      "gillespie2014relevance",
      "The Relevance of Algorithms",
      "Gillespie",
      "Tarleton",
      2014,
      "Frequently cited baseline for algorithmic gatekeeping.",
    ],
    [
      "napoli2019social",
      "Social Media and the Public Interest",
      "Napoli",
      "Philip",
      2019,
      "Links platform governance to media policy.",
    ],
  ] as const;

  registry
    .bind(chatBackends, async () => ({
      default: "claude-code",
      backends: [
        { id: "claude-code", label: "Claude Code", available: true, detail: "ready" },
        {
          id: "codex",
          label: "Codex",
          available: false,
          detail: "Not logged in. Run `codex login` in a terminal, then retry.",
        },
        { id: "cursor", label: "Cursor", available: true, detail: "ready" },
      ],
    }))
    .bind(chatStart, async (_ctx, input) => {
      const at = now();
      const { backend, title, ...context } = input;
      const session: MockSession = {
        summary: {
          id: id("ch_"),
          title: title ?? "New chat",
          backend: backend ?? "claude-code",
          kind: "chat",
          ...(context.project ? { project: context.project } : {}),
          ...(context.item ? { item: context.item } : {}),
          createdAt: at,
          updatedAt: at,
        },
        context,
        entries: [],
        turns: [],
        timers: new Set(),
        running: false,
      };
      chat.sessions.set(session.summary.id, session);
      return { session: summaryOf(session) };
    })
    .bind(chatSend, async (_ctx, input) => {
      const s = find(input.session);
      if (s.running)
        throw new Error("CHAT_BUSY: the agent is still answering the previous message");
      if (input.context) s.context = input.context;
      const turn: ChatTurn = {
        turn: s.turns.length + 1,
        status: "running",
        startedAt: now(),
        edits: [],
      };
      s.turns.push(turn);
      s.entries.push({
        id: s.entries.length,
        turn: turn.turn,
        at: now(),
        type: "user",
        text: input.message,
        ...(Object.keys(s.context).length > 0 ? { context: s.context } : {}),
      });
      if (s.summary.title === "New chat") s.summary.title = input.message.slice(0, 60);
      s.running = true;
      runTurn(s, turn, input.message);
      changed(chatChangePath(s.summary.id));
      return { turn: turn.turn };
    })
    .bind(chatCancel, async (_ctx, input) => {
      const s = find(input.session);
      for (const t of s.timers) clearTimeout(t);
      s.timers.clear();
      const turn = s.turns.at(-1);
      if (s.running && turn) {
        turn.status = "cancelled";
        turn.endedAt = now();
        s.running = false;
        changed(chatChangePath(s.summary.id));
      }
      return { ok: true as const };
    })
    .bind(chatList, async (_ctx, input) => ({
      sessions: [...chat.sessions.values()]
        .filter((s) => (input.kind ? s.summary.kind === input.kind : true))
        .filter((s) => (input.project ? s.summary.project === input.project : true))
        .sort((a, b) => b.summary.updatedAt.localeCompare(a.summary.updatedAt))
        .slice(0, input.limit)
        .map(summaryOf),
    }))
    .bind(chatGet, async (_ctx, input) => {
      const s = find(input.session);
      return {
        session: summaryOf(s),
        context: s.context,
        entries: structuredClone(s.entries),
        turns: structuredClone(s.turns),
      };
    })
    .bind(chatRevertTurn, async (_ctx, input) => {
      const s = find(input.session);
      const turn = s.turns.find((t) => t.turn === input.turn);
      if (!turn || turn.edits.length === 0) {
        throw new Error(`CHAT_TURN_NO_EDITS: turn ${input.turn} changed no files`);
      }
      turn.reverted = { at: now(), restored: turn.edits.length, conflicts: 0 };
      changed(chatChangePath(s.summary.id));
      for (const e of turn.edits) changed(e.path);
      return { restored: turn.edits.map((e) => e.path), conflicts: [] };
    })
    .bind(chatSave, async (_ctx, input) => {
      const s = find(input.session);
      const slug = s.summary.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      s.summary.saved = `chats/${now().slice(0, 10)}-${slug || "chat"}.md`;
      changed(chatChangePath(s.summary.id));
      return { path: s.summary.saved };
    })
    .bind(jobsList, async () => ({ jobs: [...chat.jobs].reverse() }))
    .bind(researchStart, async (_ctx, input) => {
      const at = now();
      const job: Job = {
        id: id("j_", 20),
        kind: "research",
        status: "running",
        progress: 0.05,
        input: { prompt: input.prompt, project: input.project, maxItems: input.maxItems },
        attempts: 1,
        by: "human",
        createdAt: at,
        updatedAt: at,
      };
      chat.jobs.push(job);
      const wanted = Math.min(input.maxItems, FINDS.length);
      const added: Array<{ citekey: string; why: string }> = [];
      const tick = (n: number) => {
        if (job.status !== "running") return;
        const find = FINDS[n];
        if (n >= wanted || !find) {
          job.status = "succeeded";
          job.progress = 1;
          const sid = id("ch_");
          const done = now();
          const entries: ChatEntry[] = [
            { id: 0, turn: 1, at, type: "user", text: input.prompt },
            ...added.map(
              (a, i): ChatEntry => ({
                id: i + 1,
                turn: 1,
                at: done,
                type: "tool",
                callId: `add-${i}`,
                title: "add_item",
                kind: "other",
                status: "done",
                tool: "add_item",
                detail: `${a.citekey} (${a.why})`,
              }),
            ),
          ];
          chat.sessions.set(sid, {
            summary: {
              id: sid,
              title: `Research: ${input.prompt.slice(0, 60)}`,
              backend: "claude-code",
              kind: "research",
              job: job.id,
              createdAt: at,
              updatedAt: done,
            },
            context: {},
            entries,
            turns: [{ turn: 1, status: "done", startedAt: at, endedAt: done, edits: [] }],
            timers: new Set(),
            running: false,
          });
          job.result = { session: sid, added, violations: [] };
          job.updatedAt = done;
          return;
        }
        const [citekey, title, family, given, year, why] = find;
        data.items.set(citekey, {
          note: "",
          frontmatter: ItemFrontmatter.parse({
            id: id(""),
            citekey,
            type: "book",
            title,
            author: [{ family, given }],
            issued: year,
            status: "unread",
            created: { at: now(), by: "agent:claude-code" },
            inbox: { by: "agent:claude-code", why },
          }),
        });
        added.push({ citekey, why });
        job.progress = 0.05 + 0.9 * ((n + 1) / wanted);
        job.updatedAt = now();
        changed(`items/${citekey}/${citekey}.md`);
        setTimeout(() => tick(n + 1), step);
      };
      setTimeout(() => tick(0), step);
      return { job: job.id };
    });
  return registry;
}
