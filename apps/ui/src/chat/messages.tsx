import type { chatGet } from "@citegeist/ops";
import { AlertTriangle, Check, Loader2, Star, Undo2, Wrench, X } from "lucide-react";
import type { z } from "zod";
import { Button } from "../components/ui/button";
import { useI18n } from "../i18n";
import { cn } from "../lib/utils";
import { AssistantText } from "./citations";

function clock(at: string, lang: string): string {
  return new Date(at).toLocaleTimeString(lang, { hour: "2-digit", minute: "2-digit" });
}

export type ChatView = z.output<typeof chatGet.output>;
type Entry = ChatView["entries"][number];
type Turn = ChatView["turns"][number];

function ToolLine({ entry }: { entry: Extract<Entry, { type: "tool" }> }) {
  const { t } = useI18n();
  const Icon =
    entry.status === "failed"
      ? X
      : entry.status === "done"
        ? Check
        : entry.status === "running"
          ? Loader2
          : Wrench;
  return (
    <div
      data-testid="chat-tool"
      className={cn(
        "flex items-start gap-1.5 text-xs text-muted",
        entry.status === "failed" && "text-danger",
      )}
    >
      <Icon
        aria-hidden="true"
        className={cn("mt-0.5 size-3 shrink-0", entry.status === "running" && "animate-spin")}
      />
      <span className="min-w-0 break-words">
        <span className="font-mono">{entry.tool ?? entry.title}</span>
        {entry.detail ? <span>{`: ${entry.detail}`}</span> : null}
        <span className="sr-only">{` (${t(`chat.tool.${entry.status}`)})`}</span>
      </span>
    </div>
  );
}

function Notice({ entry }: { entry: Extract<Entry, { type: "notice" }> }) {
  const error = entry.level === "error";
  return (
    <div
      role={error ? "alert" : "status"}
      className={cn(
        "flex items-start gap-1.5 border px-2 py-1.5 text-xs",
        error ? "border-danger text-danger" : "border-line text-muted",
      )}
    >
      {error ? <AlertTriangle aria-hidden="true" className="mt-0.5 size-3 shrink-0" /> : null}
      <span className="min-w-0 break-words">
        {entry.text}
        {entry.fix ? <span className="block text-ink">{entry.fix}</span> : null}
      </span>
    </div>
  );
}

function TurnFooter({
  turn,
  onUndo,
  undoing,
}: {
  turn: Turn;
  onUndo: (turn: number) => void;
  undoing: boolean;
}) {
  const { t, tn } = useI18n();
  const finished = turn.status !== "running";
  const done = turn.reverted !== undefined && turn.reverted.conflicts === 0;
  return (
    <div className="flex flex-col gap-1.5">
      {turn.status === "cancelled" ? (
        <p className="text-xs text-muted">{t("chat.turnCancelled")}</p>
      ) : null}
      {turn.edits.length > 0 ? (
        <div
          data-testid="chat-edits"
          className="flex flex-col gap-1 border border-line-soft px-2 py-1.5"
        >
          <p className="text-xs text-muted">{tn("chat.edits", turn.edits.length)}</p>
          <ul className="flex flex-col gap-0.5 text-xs">
            {turn.edits.map((e) => (
              <li key={e.path} className="flex min-w-0 gap-1.5">
                <span className="shrink-0 text-muted">{t(`chat.edit.${e.change}`)}</span>
                <span className="min-w-0 truncate font-mono" title={e.path}>
                  {e.path}
                </span>
              </li>
            ))}
          </ul>
          {done ? (
            <p className="flex items-center gap-1 text-xs text-muted">
              <Check aria-hidden="true" className="size-3" />
              {t("chat.undone")}
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                aria-label={`${t("chat.undoTurn")} (${turn.turn})`}
                disabled={!finished || undoing}
                onClick={() => onUndo(turn.turn)}
              >
                <Undo2 aria-hidden="true" className="size-3.5" />
                {t("chat.undo")}
              </Button>
              {turn.reverted && turn.reverted.conflicts > 0 ? (
                <span role="status" className="text-xs text-danger">
                  {tn("chat.undoConflicts", turn.reverted.conflicts)}
                </span>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** The transcript of one session. Every turn that changed files ends with an undo button. */
export function Messages({
  view,
  onUndo,
  undoing,
}: {
  view: ChatView;
  onUndo: (turn: number) => void;
  undoing: boolean;
}) {
  const { t, lang } = useI18n();
  return (
    <ol aria-label={t("chat.messages")} className="flex flex-col gap-4">
      {view.turns.map((turn) => (
        <li key={turn.turn} data-testid="chat-turn" className="flex flex-col gap-2">
          {view.entries
            .filter((e) => e.turn === turn.turn)
            .map((e) => {
              switch (e.type) {
                case "user":
                  return (
                    <div key={e.id} className="flex flex-col items-end gap-1">
                      <p className="text-[11px] text-muted">{`${t("chat.you")} · ${clock(e.at, lang)}`}</p>
                      <p className="max-w-[280px] whitespace-pre-wrap break-words bg-sunken px-3 py-2.5">
                        {e.text}
                      </p>
                    </div>
                  );
                case "assistant":
                  return (
                    <div key={e.id} data-testid="chat-answer" className="flex flex-col gap-1.5">
                      <p className="flex items-center gap-1.5 font-mono text-[11px] text-muted">
                        <Star aria-hidden="true" className="size-2.5 fill-current" />
                        {`${view.session.backend} · ${clock(e.at, lang)}`}
                      </p>
                      <AssistantText text={e.text} />
                    </div>
                  );
                case "tool":
                  return <ToolLine key={e.id} entry={e} />;
                case "notice":
                  return <Notice key={e.id} entry={e} />;
                default:
                  return null;
              }
            })}
          {turn.status === "running" ? (
            <p role="status" className="flex items-center gap-1.5 text-xs text-muted">
              <Loader2 aria-hidden="true" className="size-3 animate-spin" />
              {t("chat.working")}
            </p>
          ) : null}
          <TurnFooter turn={turn} onUndo={onUndo} undoing={undoing} />
        </li>
      ))}
    </ol>
  );
}
