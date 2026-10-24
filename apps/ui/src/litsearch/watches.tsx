import {
  type LitsearchRunSummary,
  type LitsearchWatch,
  litsearchWatchBackground,
  litsearchWatchDelete,
  litsearchWatches,
  litsearchWatchRun,
  litsearchWatchSave,
  litsearchWatchSeen,
} from "@citegeist/ops";
import { Link, useNavigate } from "@tanstack/react-router";
import { Eye } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import { HeaderSlot, SubBar } from "../components/layout";
import { Badge, StatusSquare } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Segmented } from "../components/ui/segmented";
import { EmptyState, ErrorState, Loading } from "../components/ui/states";
import { type MessageKey, useI18n } from "../i18n";
import { useOp, useOpMutation } from "../lib/hooks";
import { ErrorLine, FieldLabel, useGuarded } from "../settings/parts";

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0] as const;

/** "Runs | Watchlists" in the sub bar of both lists. */
export function LitsearchTabs({ active }: { active: "runs" | "watches" }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  return (
    <Segmented
      variant="tabs"
      label={t("litsearch.tabs")}
      value={active}
      onChange={(v) => void navigate({ to: v === "runs" ? "/litsearch" : "/litsearch/watches" })}
      options={[
        { value: "runs", label: t("litsearch.runs") },
        { value: "watches", label: t("litsearch.watches") },
      ]}
    />
  );
}

function ScheduleFields({
  weekday,
  time,
  onWeekday,
  onTime,
}: {
  weekday: number;
  time: string;
  onWeekday: (n: number) => void;
  onTime: (s: string) => void;
}) {
  const { t } = useI18n();
  const ids = { day: useId(), time: useId() };
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1">
        <FieldLabel htmlFor={ids.day}>{t("litsearch.watch.weekday")}</FieldLabel>
        <select
          id={ids.day}
          value={weekday}
          onChange={(e) => onWeekday(Number(e.target.value))}
          className="h-7 border border-line bg-transparent px-2 text-[13px]"
        >
          {WEEKDAYS.map((d) => (
            <option key={d} value={d}>
              {t(`litsearch.weekday.${d}` as MessageKey)}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <FieldLabel htmlFor={ids.time}>{t("litsearch.watch.time")}</FieldLabel>
        <Input
          id={ids.time}
          type="time"
          value={time}
          onChange={(e) => onTime(e.target.value)}
          className="w-28"
        />
      </div>
    </div>
  );
}

/** "Save as watchlist" on a finished run: weekday and time, then the watchlist list. */
export function SaveAsWatch({ run }: { run: LitsearchRunSummary }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const save = useOpMutation(litsearchWatchSave);
  const guard = useGuarded();
  const [open, setOpen] = useState(false);
  const [weekday, setWeekday] = useState(1);
  const [time, setTime] = useState("08:00");
  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)}>
        <Eye className="size-3.5" />
        {t("litsearch.watch.save")}
      </Button>
    );
  }
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const out = await guard.run(() =>
      save.mutateAsync({
        fromRun: run.id,
        topic: run.topic,
        queries: run.queries,
        ...(run.since !== undefined ? { since: run.since } : {}),
        ...(run.top !== undefined ? { top: run.top } : {}),
        weekday,
        time,
      }),
    );
    if (out) void navigate({ to: "/litsearch/watches" });
  };
  return (
    <form
      aria-label={t("litsearch.watch.saveTitle")}
      onSubmit={(e) => void submit(e)}
      className="flex max-w-[720px] flex-col gap-3 border border-line p-4"
    >
      <p className="font-medium">{t("litsearch.watch.saveTitle")}</p>
      <p className="text-[12px] text-muted">{t("litsearch.watch.saveHint")}</p>
      <ScheduleFields weekday={weekday} time={time} onWeekday={setWeekday} onTime={setTime} />
      <div className="flex gap-2">
        <Button type="submit" size="sm" variant="primary" disabled={save.isPending}>
          {t("litsearch.watch.create")}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          {t("common.cancel")}
        </Button>
      </div>
      <ErrorLine error={guard.error} />
    </form>
  );
}

function WatchRow({ watch }: { watch: LitsearchWatch }) {
  const { t, tn } = useI18n();
  const navigate = useNavigate();
  const toggle = useOpMutation(litsearchWatchBackground);
  const runNow = useOpMutation(litsearchWatchRun);
  const remove = useOpMutation(litsearchWatchDelete);
  const seen = useOpMutation(litsearchWatchSeen);
  const save = useOpMutation(litsearchWatchSave);
  const guard = useGuarded();
  const [editing, setEditing] = useState(false);
  const [weekday, setWeekday] = useState(watch.weekday);
  const [time, setTime] = useState(watch.time);
  const switchId = useId();
  const latest = watch.runs.at(-1);
  const day = t(`litsearch.weekday.${watch.weekday}` as MessageKey);

  const openLatest = async () => {
    if (!latest) return;
    await guard.run(() => seen.mutateAsync({ id: watch.id }));
    void navigate({ to: "/litsearch/$runId", params: { runId: latest } });
  };

  return (
    <li
      data-testid="litsearch-watch"
      className="flex flex-col gap-3 border-b border-line px-8 py-5"
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="font-serif text-[18px] font-medium leading-tight">{watch.topic}</span>
          <span className="truncate font-mono text-[12px] text-muted">
            {watch.queries.join("  ·  ")}
          </span>
          <span className="text-[12px] text-muted">
            {[
              t("litsearch.watch.schedule", { day, time: watch.time }),
              watch.lastRun
                ? t("litsearch.watch.lastRun", {
                    date: watch.lastRun.replace("T", " ").slice(0, 16),
                  })
                : t("litsearch.watch.never"),
              watch.lastNew !== undefined
                ? tn("litsearch.watch.lastNew", watch.lastNew)
                : undefined,
              tn("litsearch.watch.runs", watch.runs.length),
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            {watch.unseen > 0 ? (
              <Badge tone="accent">{t("litsearch.watch.unseen", { n: watch.unseen })}</Badge>
            ) : null}
            {watch.running ? (
              <span className="inline-flex items-center gap-1.5 text-[12px]">
                <StatusSquare className="animate-pulse" />
                {t("litsearch.watch.running")}
              </span>
            ) : null}
            {watch.lastStatus === "failed" ? (
              <span className="text-[12px] text-danger">{t("litsearch.status.failed")}</span>
            ) : null}
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <label htmlFor={switchId} className="flex cursor-pointer items-center gap-2 text-[12px]">
            <input
              id={switchId}
              type="checkbox"
              role="switch"
              aria-checked={watch.background}
              className="size-3.5"
              checked={watch.background}
              disabled={toggle.isPending}
              onChange={() =>
                void guard.run(() =>
                  toggle.mutateAsync({ id: watch.id, enabled: !watch.background }),
                )
              }
            />
            {t("litsearch.watch.background")}
          </label>
          <div className="flex flex-wrap justify-end gap-2">
            {latest ? (
              <Button size="sm" variant="ghost" onClick={() => void openLatest()}>
                {t("litsearch.watch.openLatest")}
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="primary"
              disabled={watch.running || runNow.isPending}
              onClick={() =>
                void guard
                  .run(() => runNow.mutateAsync({ id: watch.id }))
                  .then((out) => {
                    if (out)
                      void navigate({ to: "/litsearch/$runId", params: { runId: out.runId } });
                  })
              }
            >
              {t("litsearch.watch.runNow")}
            </Button>
            <Button size="sm" onClick={() => setEditing((v) => !v)}>
              {t("litsearch.watch.edit")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={remove.isPending}
              onClick={() => {
                if (window.confirm(t("litsearch.watch.confirmDelete", { topic: watch.topic }))) {
                  void guard.run(() => remove.mutateAsync({ id: watch.id }));
                }
              }}
            >
              {t("litsearch.watch.delete")}
            </Button>
          </div>
        </div>
      </div>
      <p className="max-w-[640px] text-[12px] text-muted">{t("litsearch.watch.backgroundHint")}</p>
      {watch.background && !watch.agentLoaded ? (
        <p role="alert" className="text-[12px] text-danger">
          {t("litsearch.watch.agentMissing")}
        </p>
      ) : null}
      {editing ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void guard
              .run(() =>
                save.mutateAsync({
                  id: watch.id,
                  topic: watch.topic,
                  queries: watch.queries,
                  ...(watch.since !== undefined ? { since: watch.since } : {}),
                  ...(watch.top !== undefined ? { top: watch.top } : {}),
                  weekday,
                  time,
                }),
              )
              .then((out) => out && setEditing(false));
          }}
          className="flex flex-wrap items-end gap-3"
        >
          <ScheduleFields weekday={weekday} time={time} onWeekday={setWeekday} onTime={setTime} />
          <Button type="submit" size="sm" variant="primary" disabled={save.isPending}>
            {t("litsearch.watch.saveSchedule")}
          </Button>
        </form>
      ) : null}
      <ErrorLine error={guard.error} />
    </li>
  );
}

/** The watchlists of the library. */
export function LitsearchWatchesScreen() {
  const { t } = useI18n();
  const watches = useOp(
    litsearchWatches,
    {},
    { refetchInterval: (q) => (q.state.data?.watches.some((w) => w.running) ? 2000 : false) },
  );
  const list = watches.data?.watches ?? [];
  return (
    <div className="flex h-full min-h-0 flex-col">
      <HeaderSlot>
        <Link to="/litsearch" className="text-[13px] font-medium hover:underline">
          {t("litsearch.title")}
        </Link>
      </HeaderSlot>
      <SubBar className="items-center">
        <LitsearchTabs active="watches" />
      </SubBar>
      {watches.isPending ? (
        <Loading label={t("litsearch.watches.loading")} />
      ) : watches.isError ? (
        <ErrorState error={watches.error} />
      ) : list.length === 0 ? (
        <EmptyState
          icon={<Eye />}
          title={t("litsearch.watches.emptyTitle")}
          description={t("litsearch.watches.emptyDescription")}
        />
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {list.map((w) => (
            <WatchRow key={w.id} watch={w} />
          ))}
        </ul>
      )}
    </div>
  );
}
