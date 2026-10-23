import {
  type ChatContext,
  chatBackends,
  chatCancel,
  chatGet,
  chatList,
  chatRevertTurn,
  chatSave,
  chatSend,
  chatStart,
} from "@citegeist/ops";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, MessageSquarePlus, SendHorizontal, Square, X } from "lucide-react";
import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";
import { Button } from "../components/ui/button";
import { Select } from "../components/ui/select";
import { EmptyState, ErrorState, Loading } from "../components/ui/states";
import { useI18n } from "../i18n";
import { useCore, useOp, useOpMutation } from "../lib/hooks";
import { describeError } from "../lib/utils";
import { useChatSelection, useScreenContext } from "./context";
import { Messages } from "./messages";

type Chip = "project" | "item" | "selection";

function ContextChips({
  context,
  onRemove,
}: {
  context: ChatContext;
  onRemove: (chip: Chip) => void;
}) {
  const { t } = useI18n();
  const chips: Array<{ id: Chip; label: string }> = [
    ...(context.project
      ? [{ id: "project" as const, label: t("chat.context.project", { slug: context.project }) }]
      : []),
    ...(context.item
      ? [{ id: "item" as const, label: t("chat.context.item", { citekey: context.item }) }]
      : []),
    ...(context.selection
      ? [
          {
            id: "selection" as const,
            label: context.selection.page
              ? t("chat.context.selectionPage", { page: context.selection.page })
              : t("chat.context.selection"),
          },
        ]
      : []),
  ];
  if (chips.length === 0) return null;
  return (
    <ul aria-label={t("chat.contextLabel")} className="flex flex-wrap gap-1.5">
      {chips.map((c) => (
        <li
          key={c.id}
          data-testid={`chat-chip-${c.id}`}
          className="flex max-w-full items-center gap-1 border border-line bg-sunken pl-1.5 text-xs"
        >
          <span className="min-w-0 truncate">{c.label}</span>
          <button
            type="button"
            aria-label={t("chat.context.remove", { what: c.label })}
            onClick={() => onRemove(c.id)}
            className="p-1 text-muted hover:text-ink"
          >
            <X aria-hidden="true" className="size-3" />
          </button>
        </li>
      ))}
    </ul>
  );
}

/** The chat: agent picker, context chips, streamed transcript with undo, composer. */
export function Conversation({ openSession }: { openSession?: string | null }) {
  const { t } = useI18n();
  const core = useCore();
  const queryClient = useQueryClient();
  const screen = useScreenContext();
  const marked = useChatSelection();

  const backends = useOp(chatBackends, {});
  const history = useOp(chatList, { kind: "chat", limit: 30 });
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [agent, setAgent] = useState<string | undefined>(undefined);
  const [draft, setDraft] = useState("");
  const [removed, setRemoved] = useState<ReadonlySet<Chip>>(new Set());
  const [failure, setFailure] = useState<unknown>(null);
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);

  // The research tab can send us to the transcript of a job.
  useEffect(() => {
    if (openSession) {
      setSessionId(openSession);
      setSavedPath(null);
    }
  }, [openSession]);

  // A chip the user removed stays removed until the screen shows something else.
  const screenKey = `${screen.project ?? ""}|${screen.item ?? ""}`;
  // biome-ignore lint/correctness/useExhaustiveDependencies: the key is the trigger
  useEffect(() => setRemoved(new Set()), [screenKey]);
  const selectionKey = marked ? `${marked.citekey}|${marked.text}` : "";
  // biome-ignore lint/correctness/useExhaustiveDependencies: the key is the trigger
  useEffect(
    () =>
      setRemoved((r) =>
        r.has("selection") ? new Set([...r].filter((c) => c !== "selection")) : r,
      ),
    [selectionKey],
  );

  const context: ChatContext = {
    ...(screen.project && !removed.has("project") ? { project: screen.project } : {}),
    ...(screen.item && !removed.has("item") ? { item: screen.item } : {}),
    ...(marked && !removed.has("selection") ? { selection: marked } : {}),
  };

  // Streaming: the core announces `chat/<session>` and only this query refetches. A slow poll
  // covers a missed event while the agent works.
  const view = useQuery({
    queryKey: ["op", chatGet.name, { session: sessionId }],
    queryFn: () => core.call(chatGet, { session: sessionId as string }),
    enabled: sessionId !== null,
    refetchInterval: (q) => (q.state.data?.session.running ? 2000 : false),
  });
  useEffect(
    () =>
      core.subscribe((e) => {
        if (!e.path.startsWith("chat/")) return;
        void queryClient.invalidateQueries({ queryKey: ["op", chatGet.name] });
        void queryClient.invalidateQueries({ queryKey: ["op", chatList.name] });
      }),
    [core, queryClient],
  );

  const turns = view.data?.turns.length ?? 0;
  const lastLength = view.data?.entries.at(-1)
    ? JSON.stringify(view.data.entries.at(-1)).length
    : 0;
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when the transcript grows
  useEffect(() => bottom.current?.scrollIntoView({ block: "end" }), [turns, lastLength, sessionId]);

  const start = useOpMutation(chatStart);
  const send = useOpMutation(chatSend);
  const cancel = useOpMutation(chatCancel);
  const revert = useOpMutation(chatRevertTurn);
  const save = useOpMutation(chatSave);

  const running = view.data?.session.running === true;
  const agentId = sessionId
    ? (view.data?.session.backend ?? agent)
    : (agent ?? backends.data?.default);

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    const message = draft.trim();
    if (!message || running || send.isPending || start.isPending) return;
    setFailure(null);
    try {
      let id = sessionId;
      if (!id) {
        const started = await start.mutateAsync({
          ...(agentId ? { backend: agentId } : {}),
          ...context,
        });
        id = started.session.id;
        setSessionId(id);
      }
      setDraft("");
      await send.mutateAsync({ session: id, message, context });
    } catch (err) {
      setFailure(err);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submit();
    }
  };

  const reset = () => {
    setSessionId(null);
    setSavedPath(null);
    setFailure(null);
  };

  const backendOptions = (backends.data?.backends ?? []).map((b) => ({
    value: b.id,
    label: b.available ? b.label : t("chat.agentNotReady", { label: b.label }),
  }));
  const current = backends.data?.backends.find((b) => b.id === agentId);
  const historyOptions = [
    { value: "", label: t("chat.historyNew") },
    ...(history.data?.sessions ?? []).map((s) => ({ value: s.id, label: s.title })),
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-col gap-2 border-b border-line px-3 py-2">
        <div className="flex items-center gap-1.5">
          {sessionId ? (
            <span className="min-w-0 flex-1 truncate text-sm font-medium">
              {current?.label ?? agentId}
            </span>
          ) : (
            <Select
              label={t("chat.agent")}
              value={agentId ?? ""}
              onChange={setAgent}
              options={backendOptions}
              className="min-w-0 flex-1 rounded-none"
            />
          )}
          {sessionId && view.data ? (
            <Button
              variant="ghost"
              size="icon"
              className="rounded-none"
              aria-label={t("chat.save")}
              title={t("chat.save")}
              disabled={save.isPending || running}
              onClick={() =>
                save.mutate({ session: sessionId }, { onSuccess: (r) => setSavedPath(r.path) })
              }
            >
              <FileText aria-hidden="true" className="size-4" />
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="icon"
            className="rounded-none"
            aria-label={t("chat.new")}
            title={t("chat.new")}
            disabled={sessionId === null}
            onClick={reset}
          >
            <MessageSquarePlus aria-hidden="true" className="size-4" />
          </Button>
        </div>
        {(history.data?.sessions.length ?? 0) > 0 ? (
          <Select
            label={t("chat.history")}
            value={sessionId ?? ""}
            onChange={(id) => {
              setSessionId(id === "" ? null : id);
              setSavedPath(null);
            }}
            options={historyOptions}
            className="w-full min-w-0 rounded-none"
          />
        ) : null}
        {!sessionId && current && !current.available && current.detail ? (
          <p role="status" className="text-xs text-muted">
            {t("chat.agentDetail", { label: current.label, detail: current.detail })}
          </p>
        ) : null}
        {savedPath ? (
          <p role="status" className="text-xs text-muted">
            {t("chat.saved", { path: savedPath })}
          </p>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {sessionId === null ? (
          <EmptyState title={t("chat.emptyTitle")} description={t("chat.emptyDescription")} />
        ) : view.isPending ? (
          <Loading label={t("chat.loading")} />
        ) : view.isError ? (
          <ErrorState error={view.error} />
        ) : (
          <Messages
            view={view.data}
            undoing={revert.isPending}
            onUndo={(turn) =>
              revert.mutate({ session: sessionId, turn }, { onError: (err) => setFailure(err) })
            }
          />
        )}
        <div ref={bottom} />
      </div>

      <form onSubmit={submit} className="flex flex-col gap-2 border-t border-line px-3 py-2">
        <ContextChips
          context={context}
          onRemove={(chip) => setRemoved((r) => new Set([...r, chip]))}
        />
        {failure ? (
          <p role="alert" className="text-xs text-danger">
            {(() => {
              const { message, fix } = describeError(failure, t("common.error"));
              return fix ? `${message} ${fix}` : message;
            })()}
          </p>
        ) : null}
        <label className="sr-only" htmlFor="chat-composer">
          {t("chat.composerLabel")}
        </label>
        <textarea
          id="chat-composer"
          rows={3}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t("chat.placeholder")}
          className="w-full resize-none border border-line bg-surface px-2.5 py-1.5 text-sm placeholder:text-muted"
        />
        <div className="flex justify-end gap-2">
          {running && sessionId ? (
            <Button
              variant="outline"
              className="rounded-none"
              onClick={() => cancel.mutate({ session: sessionId })}
            >
              <Square aria-hidden="true" className="size-3.5" />
              {t("chat.stop")}
            </Button>
          ) : null}
          <Button
            type="submit"
            variant="primary"
            className="rounded-none"
            disabled={draft.trim() === "" || running || send.isPending || start.isPending}
          >
            <SendHorizontal aria-hidden="true" className="size-3.5" />
            {t("chat.send")}
          </Button>
        </div>
      </form>
    </div>
  );
}
