import {
  type LitsearchRunSummary,
  type LitsearchSource,
  type LitsearchStage,
  litsearchCancel,
  litsearchGet,
  litsearchResume,
  litsearchRuns,
  litsearchStart,
  litsearchSuggest,
  settingsGet,
} from "@citegeist/ops";
import { Link, useNavigate } from "@tanstack/react-router";
import { Plus, Telescope, X } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import { HeaderSlot, Label, RightColumn, SubBar } from "../components/layout";
import { Badge, StatusSquare } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { EmptyState, ErrorState, Loading } from "../components/ui/states";
import { type MessageKey, useI18n } from "../i18n";
import { useOp, useOpMutation } from "../lib/hooks";
import { cn } from "../lib/utils";
import { Bar, ErrorLine, FieldLabel, Section, useGuarded } from "../settings/parts";
import { ResultCharts } from "./charts";
import { CompareWith } from "./compare";
import { Downloads, PaperDetail, ResultsTable } from "./results";
import { SaveAsAlert } from "./save-as-alert";
import { LitsearchTabs } from "./tabs";

const SOURCES: readonly LitsearchSource[] = ["dblp", "openreview", "unpaywall", "orcid"];
/** How often an open run is read again while it runs. */
const POLL_MS = 1000;

function useStatusLabel() {
  const { t } = useI18n();
  return (status: LitsearchRunSummary["status"]) => t(`litsearch.status.${status}` as MessageKey);
}

function StatusChip({ status }: { status: LitsearchRunSummary["status"] }) {
  const label = useStatusLabel();
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-[12px]",
        status === "failed" && "text-danger",
        status !== "running" && status !== "failed" && "text-muted",
      )}
    >
      <StatusSquare filled={status === "running" || status === "done"} />
      {label(status)}
    </span>
  );
}

function Title({ children }: { children?: React.ReactNode }) {
  const { t } = useI18n();
  return (
    <HeaderSlot>
      <Link to="/litsearch" className="text-[13px] font-medium hover:underline">
        {t("litsearch.title")}
      </Link>
      {children}
    </HeaderSlot>
  );
}

/** The runs of the library, newest first, with the button to a new search. */
export function LitsearchRunsScreen() {
  const { t, tn } = useI18n();
  const navigate = useNavigate();
  const toNew = () => void navigate({ to: "/litsearch/new" });
  const runs = useOp(
    litsearchRuns,
    { limit: 200 },
    {
      refetchInterval: (q) =>
        q.state.data?.runs.some((r) => r.status === "running") ? POLL_MS : false,
    },
  );
  const list = runs.data?.runs ?? [];
  return (
    <div className="flex h-full min-h-0 flex-col">
      <Title>
        {list.length > 0 ? (
          <span className="font-mono text-[12px] text-muted">
            {tn("litsearch.count", list.length)}
          </span>
        ) : null}
      </Title>
      <SubBar className="items-center">
        <LitsearchTabs active="runs" />
        <Button variant="primary" size="sm" onClick={toNew}>
          <Plus className="size-3.5" />
          {t("litsearch.new")}
        </Button>
      </SubBar>
      {runs.isPending ? (
        <Loading label={t("litsearch.loading")} />
      ) : runs.isError ? (
        <ErrorState error={runs.error} />
      ) : list.length === 0 ? (
        <EmptyState
          icon={<Telescope />}
          title={t("litsearch.emptyTitle")}
          description={t("litsearch.emptyDescription")}
          action={
            <Button variant="primary" onClick={toNew}>
              {t("litsearch.new")}
            </Button>
          }
        />
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {list.map((run) => {
            const papers = Object.entries(run.counts)
              .filter(([k]) => k !== "rejected")
              .reduce((n, [, v]) => n + v, 0);
            return (
              <li key={run.id} data-testid="litsearch-run" className="border-b border-line">
                <Link
                  to="/litsearch/$runId"
                  params={{ runId: run.id }}
                  className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 px-8 py-4 hover:bg-sunken"
                >
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="font-serif text-[18px] font-medium leading-tight">
                      {run.topic}
                    </span>
                    <span className="truncate font-mono text-[12px] text-muted">
                      {run.queries.join("  ·  ")}
                    </span>
                  </div>
                  <div className="flex flex-col items-end gap-1 text-[12px] text-muted">
                    <StatusChip status={run.status} />
                    <span>{run.created.replace("T", " ").slice(0, 16)}</span>
                    {run.status === "done" ? <span>{tn("litsearch.papers", papers)}</span> : null}
                    {run.alert ? <Badge>{t("litsearch.fromAlert")}</Badge> : null}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Topic, suggested or own queries, options; starting it opens the progress of the new run. */
export function LitsearchNewScreen() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const settings = useOp(settingsGet, {});
  const suggest = useOpMutation(litsearchSuggest);
  const start = useOpMutation(litsearchStart);
  const guard = useGuarded();
  const [topic, setTopic] = useState("");
  const [queries, setQueries] = useState<string[]>([""]);
  const [since, setSince] = useState("");
  const [top, setTop] = useState("");
  const [off, setOff] = useState<ReadonlySet<LitsearchSource>>(new Set());
  const ids = { topic: useId(), since: useId(), top: useId() };
  const noKey = settings.data ? settings.data.settings.ai.apiKeys.openalex !== true : false;

  const filled = queries.map((q) => q.trim()).filter(Boolean);
  const year = since.trim() ? Number(since) : undefined;
  const topN = top.trim() ? Number(top) : undefined;
  const valid =
    topic.trim() !== "" &&
    filled.length > 0 &&
    (year === undefined || (Number.isInteger(year) && year >= 1900 && year <= 2100)) &&
    (topN === undefined || (Number.isInteger(topN) && topN >= 1 && topN <= 500));

  const getSuggestions = async () => {
    const out = await guard.run(() => suggest.mutateAsync({ topic: topic.trim(), maxQueries: 10 }));
    if (out?.queries.length) setQueries(out.queries);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    const out = await guard.run(() =>
      start.mutateAsync({
        topic: topic.trim(),
        queries: filled,
        ...(year !== undefined ? { since: year } : {}),
        ...(topN !== undefined ? { top: topN } : {}),
        disableSources: [...off],
      }),
    );
    if (out) void navigate({ to: "/litsearch/$runId", params: { runId: out.runId } });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Title>
        <span className="text-[13px] text-muted">/</span>
        <span className="text-[13px] font-medium">{t("litsearch.new")}</span>
      </Title>
      <form
        onSubmit={(e) => void submit(e)}
        className="flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto px-8 py-6"
      >
        <div className="flex max-w-[720px] flex-col gap-2">
          <FieldLabel htmlFor={ids.topic}>{t("litsearch.form.topic")}</FieldLabel>
          <div className="flex gap-2">
            <Input
              id={ids.topic}
              value={topic}
              placeholder={t("litsearch.form.topicPlaceholder")}
              onChange={(e) => setTopic(e.target.value)}
              className="h-8 text-[14px]"
            />
            <Button
              type="button"
              disabled={!topic.trim() || suggest.isPending}
              onClick={() => void getSuggestions()}
            >
              {suggest.isPending ? t("litsearch.form.suggesting") : t("litsearch.form.suggest")}
            </Button>
          </div>
          <p className="text-sm text-muted">{t("litsearch.form.suggestHint")}</p>
        </div>

        <Section
          id="litsearch-queries"
          title={t("litsearch.form.queries")}
          description={t("litsearch.form.queriesHint")}
        >
          <ol className="flex max-w-[720px] flex-col gap-2">
            {queries.map((q, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: rows are edited in place by position
              <li key={i} className="flex items-center gap-2">
                <span className="w-5 text-right font-mono text-[12px] text-muted">{i + 1}</span>
                <Input
                  value={q}
                  aria-label={t("litsearch.form.query", { n: i + 1 })}
                  onChange={(e) =>
                    setQueries((prev) => prev.map((v, j) => (j === i ? e.target.value : v)))
                  }
                  className="font-mono"
                />
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label={t("litsearch.form.removeQuery", { n: i + 1 })}
                  disabled={queries.length === 1}
                  onClick={() => setQueries((prev) => prev.filter((_, j) => j !== i))}
                >
                  <X className="size-3.5" />
                </Button>
              </li>
            ))}
          </ol>
          <div>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={queries.length >= 20}
              onClick={() => setQueries((prev) => [...prev, ""])}
            >
              <Plus className="size-3.5" />
              {t("litsearch.form.addQuery")}
            </Button>
          </div>
        </Section>

        <Section id="litsearch-options" title={t("litsearch.form.options")}>
          <div className="flex flex-wrap gap-8">
            <div className="flex flex-col gap-1">
              <FieldLabel htmlFor={ids.since}>{t("litsearch.form.since")}</FieldLabel>
              <Input
                id={ids.since}
                inputMode="numeric"
                value={since}
                placeholder="2020"
                onChange={(e) => setSince(e.target.value)}
                className="w-28"
              />
              <p className="text-sm text-muted">{t("litsearch.form.sinceHint")}</p>
            </div>
            <div className="flex flex-col gap-1">
              <FieldLabel htmlFor={ids.top}>{t("litsearch.form.top")}</FieldLabel>
              <Input
                id={ids.top}
                inputMode="numeric"
                value={top}
                placeholder="40"
                onChange={(e) => setTop(e.target.value)}
                className="w-28"
              />
              <p className="max-w-xs text-sm text-muted">{t("litsearch.form.topHint")}</p>
            </div>
          </div>
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1 text-[11px] font-semibold uppercase tracking-[0.1em]">
              {t("litsearch.form.sources")}
            </legend>
            {SOURCES.map((s) => (
              <label key={s} className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  className="size-3.5"
                  checked={!off.has(s)}
                  onChange={() =>
                    setOff((prev) => {
                      const next = new Set(prev);
                      if (!next.delete(s)) next.add(s);
                      return next;
                    })
                  }
                />
                {t(`litsearch.form.source.${s}` as MessageKey)}
              </label>
            ))}
          </fieldset>
        </Section>

        <div className="flex max-w-[720px] flex-col gap-3 border-t border-line pt-6">
          {noKey ? (
            <p className="text-sm">
              {t("litsearch.form.noKey")}{" "}
              <Link to="/settings" className="underline">
                {t("litsearch.form.keyLink")}
              </Link>
            </p>
          ) : null}
          <div>
            <Button type="submit" variant="primary" disabled={!valid || start.isPending}>
              {start.isPending ? t("litsearch.form.starting") : t("litsearch.form.start")}
            </Button>
          </div>
          <ErrorLine error={guard.error} />
        </div>
      </form>
    </div>
  );
}

function StageRow({ stage }: { stage: LitsearchStage }) {
  const { t } = useI18n();
  return (
    <li
      data-testid="litsearch-stage"
      data-status={stage.status}
      className={cn(
        "grid grid-cols-[16px_minmax(0,1fr)_auto] items-baseline gap-3 py-1.5",
        stage.status === "pending" || stage.status === "skipped" ? "text-muted" : "",
        stage.status === "failed" && "text-danger",
      )}
    >
      <StatusSquare
        filled={stage.status === "done"}
        className={stage.status === "running" ? "animate-pulse" : ""}
      />
      <span>
        {stage.label}
        {stage.note && stage.status === "running" ? (
          <span className="ml-2 text-[12px] text-muted">
            {stage.total ? `${stage.done ?? 0}/${stage.total} ` : ""}
            {stage.note}
          </span>
        ) : null}
      </span>
      <span className="font-mono text-[12px] text-muted">
        {stage.status === "done" && stage.seconds !== undefined
          ? t("litsearch.stage.seconds", { s: stage.seconds })
          : t(`litsearch.stage.${stage.status}` as MessageKey)}
      </span>
    </li>
  );
}

/**
 * Share of the run done, 0 to 1: finished, failed and skipped stages, plus the running stage by
 * its own counter (e.g. 12 of 40 authors), so the percentage moves between stages too.
 */
export function runProgress(stages: readonly LitsearchStage[]): number {
  if (stages.length === 0) return 0;
  let done = 0;
  for (const s of stages) {
    if (s.status === "done" || s.status === "skipped" || s.status === "failed") done += 1;
    else if (s.status === "running" && s.total) done += Math.min(1, (s.done ?? 0) / s.total);
  }
  return Math.min(1, done / stages.length);
}

function Stages({ stages }: { stages: readonly LitsearchStage[] }) {
  return (
    <ol className="flex flex-col">
      {stages.map((s) => (
        <StageRow key={s.id} stage={s} />
      ))}
    </ol>
  );
}

/** One run: settings, live stages with percentage, and for a finished run the results. */
export function LitsearchRunScreen({ runId }: { runId: string }) {
  const { t } = useI18n();
  const got = useOp(
    litsearchGet,
    { runId },
    { refetchInterval: (q) => (q.state.data?.run.status === "running" ? POLL_MS : false) },
  );
  const cancel = useOpMutation(litsearchCancel);
  const resume = useOpMutation(litsearchResume);
  const guard = useGuarded();
  const [selected, setSelected] = useState<string>();

  if (got.isPending) return <Loading label={t("common.loading")} />;
  if (got.isError) {
    return (
      <div className="flex h-full flex-col">
        <Title />
        <ErrorState error={got.error} />
      </div>
    );
  }
  const { run, stages, papers } = got.data;
  const progress = runProgress(stages);
  const percent = Math.round(progress * 100);
  const done = run.status === "done";
  const canResume =
    run.status === "failed" || run.status === "cancelled" || run.status === "interrupted";

  const main = (
    <div className="flex min-w-0 flex-1 flex-col">
      <SubBar className="items-center">
        <div className="flex items-center gap-4">
          <StatusChip status={run.status} />
          {run.status === "running" ? (
            <span data-testid="litsearch-percent" className="font-mono text-[12px]">
              {t("litsearch.run.percent", { p: percent })}
            </span>
          ) : null}
          <span className="text-[12px] text-muted">
            {[
              run.created.replace("T", " ").slice(0, 16),
              run.since !== undefined ? t("litsearch.run.since", { year: run.since }) : undefined,
              run.top !== undefined ? t("litsearch.run.top", { n: run.top }) : undefined,
              run.attempts > 1 ? t("litsearch.run.attempt", { n: run.attempts }) : undefined,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {done ? <CompareWith run={run} /> : null}
          {run.status === "running" ? (
            <Button
              size="sm"
              disabled={cancel.isPending}
              onClick={() => void guard.run(() => cancel.mutateAsync({ runId }))}
            >
              {t("litsearch.run.cancel")}
            </Button>
          ) : null}
          {canResume ? (
            <Button
              size="sm"
              variant="primary"
              title={t("litsearch.run.resumeHint")}
              disabled={resume.isPending}
              onClick={() => void guard.run(() => resume.mutateAsync({ runId }))}
            >
              {t("litsearch.run.resume")}
            </Button>
          ) : null}
        </div>
      </SubBar>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-6 px-8 py-6">
          <ErrorLine error={guard.error} />
          {run.status === "failed" ? (
            <div role="alert" className="max-w-[720px] border border-danger px-4 py-3 text-danger">
              <p className="font-medium">{t("litsearch.run.failed")}</p>
              {run.error ? <p className="mt-1 text-[13px]">{run.error}</p> : null}
              <p className="mt-1 text-[13px] text-muted">{t("litsearch.run.resumeHint")}</p>
            </div>
          ) : run.status === "cancelled" ? (
            <p className="text-muted">{t("litsearch.run.cancelled")}</p>
          ) : run.status === "interrupted" ? (
            <p className="text-muted">{t("litsearch.run.interrupted")}</p>
          ) : null}

          {done ? (
            <>
              <section className="flex flex-wrap items-end justify-between gap-6">
                <dl className="flex flex-wrap gap-6">
                  {(["main", "preprint", "grey", "rejected"] as const).map((s) => (
                    <div key={s} className="flex flex-col">
                      <dt className="text-[12px] text-muted">
                        {t(`litsearch.section.${s}` as MessageKey)}
                      </dt>
                      <dd className="font-serif text-[24px]">{run.counts[s] ?? 0}</dd>
                    </div>
                  ))}
                </dl>
                <Downloads runId={runId} />
              </section>
              <SaveAsAlert run={run} />
              <details className="group border-t border-line pt-4">
                <summary className="cursor-pointer select-none">
                  <Label>{t("litsearch.charts")}</Label>
                </summary>
                <div className="pt-4">
                  <ResultCharts papers={papers} />
                </div>
              </details>
            </>
          ) : (
            <section className="flex max-w-[720px] flex-col gap-2">
              <Label>{t("litsearch.run.progress")}</Label>
              <div className="flex items-center gap-3">
                <Bar value={progress} label={t("litsearch.run.progress")} />
                <span className="font-mono text-[12px]">
                  {t("litsearch.run.percent", { p: percent })}
                </span>
              </div>
              <Stages stages={stages} />
            </section>
          )}

          <section className="flex max-w-[720px] flex-col gap-2">
            <Label>{t("litsearch.run.queries")}</Label>
            <ul className="flex flex-col gap-1 font-mono text-[12px]">
              {run.queries.map((q) => (
                <li key={q}>{q}</li>
              ))}
            </ul>
          </section>

          {done && stages.length > 0 ? (
            <details className="max-w-[720px]">
              <summary className="cursor-pointer select-none">
                <Label>{t("litsearch.run.stages")}</Label>
              </summary>
              <div className="pt-2">
                <Stages stages={stages} />
              </div>
            </details>
          ) : null}
        </div>
        {done ? (
          <div className="border-t border-line">
            <ResultsTable
              runId={runId}
              papers={papers}
              selected={selected}
              onSelect={setSelected}
            />
          </div>
        ) : null}
      </div>
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Title>
        <span className="text-[13px] text-muted">/</span>
        <span className="truncate text-[13px] font-medium">{run.topic}</span>
      </Title>
      {done ? (
        <div className="flex min-h-0 flex-1">
          {main}
          <RightColumn
            label={t("litsearch.detail.title")}
            tabs={[
              {
                id: "paper",
                label: t("litsearch.detail.title"),
                content: (
                  <PaperDetail runId={runId} paper={papers.find((p) => p.key === selected)} />
                ),
              },
            ]}
          />
        </div>
      ) : (
        main
      )}
    </div>
  );
}
