import { jobsList, researchStart } from "@citegeist/ops";
import type { Job } from "@citegeist/schema";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Inbox, Search } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Button } from "../components/ui/button";
import { EmptyState, ErrorState, Loading } from "../components/ui/states";
import { useI18n } from "../i18n";
import { useCore, useOpMutation } from "../lib/hooks";
import { describeError } from "../lib/utils";
import { useScreenContext } from "./context";

interface ResearchResult {
  session?: string;
  added?: Array<{ citekey: string; why?: string }>;
  violations?: string[];
}

const OPEN = new Set(["queued", "running"]);

function JobRow({ job, onOpenSession }: { job: Job; onOpenSession: (id: string) => void }) {
  const { t, tn } = useI18n();
  const input = (job.input ?? {}) as { prompt?: string };
  const result = (job.result ?? {}) as ResearchResult;
  const percent = Math.round(job.progress * 100);
  const title = (input.prompt ?? "").split("\n")[0] ?? "";
  return (
    <li
      data-testid="research-job"
      className="flex flex-col gap-1.5 border border-line-soft px-2.5 py-2"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 break-words text-sm font-medium">{title}</p>
        <span className="shrink-0 border border-line px-1.5 text-xs text-muted">
          {t(`research.status.${job.status}`)}
        </span>
      </div>
      {OPEN.has(job.status) ? (
        <div
          role="progressbar"
          aria-label={t("research.progress")}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          className="h-1.5 w-full bg-sunken"
        >
          <div className="h-full bg-agent" style={{ width: `${percent}%` }} />
        </div>
      ) : null}
      {job.status === "succeeded" ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <span>{tn("research.found", result.added?.length ?? 0)}</span>
          <Link to="/inbox" className="inline-flex items-center gap-1 text-accent hover:underline">
            <Inbox aria-hidden="true" className="size-3" />
            {t("research.toInbox")}
          </Link>
          {result.session ? (
            <button
              type="button"
              className="text-accent hover:underline"
              onClick={() => onOpenSession(result.session as string)}
            >
              {t("research.openChat")}
            </button>
          ) : null}
        </div>
      ) : null}
      {job.status === "succeeded" && (result.violations?.length ?? 0) > 0 ? (
        <p role="alert" className="text-xs text-danger">
          {t("research.violations", { list: (result.violations ?? []).join("; ") })}
        </p>
      ) : null}
      {job.status === "failed" ? (
        <p role="alert" className="text-xs text-danger">
          {t("research.failed", { message: job.error?.message ?? t("common.error") })}
        </p>
      ) : null}
    </li>
  );
}

/** Research jobs: start one, watch progress, jump to the inbox where the finds wait. */
export function ResearchJobs({ onOpenSession }: { onOpenSession: (id: string) => void }) {
  const { t } = useI18n();
  const core = useCore();
  const screen = useScreenContext();
  const [topic, setTopic] = useState("");
  const [max, setMax] = useState(10);
  const start = useOpMutation(researchStart);

  const jobs = useQuery({
    queryKey: ["op", jobsList.name, { research: true }],
    queryFn: async () => {
      const out = await core.call(jobsList, { limit: 100 });
      return out.jobs.filter((j) => j.kind === "research");
    },
    refetchInterval: (q) => (q.state.data?.some((j) => OPEN.has(j.status)) ? 1500 : false),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const prompt = topic.trim();
    if (!prompt) return;
    start.mutate(
      { prompt, maxItems: max, ...(screen.project ? { project: screen.project } : {}) },
      { onSuccess: () => setTopic("") },
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <form onSubmit={submit} className="flex flex-col gap-2 border-b border-line px-3 py-3">
        <label className="text-xs font-medium text-muted" htmlFor="research-topic">
          {t("research.topicLabel")}
        </label>
        <textarea
          id="research-topic"
          rows={3}
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder={t("research.topicPlaceholder")}
          className="w-full resize-none border border-line bg-surface px-2.5 py-1.5 text-sm placeholder:text-muted"
        />
        <div className="flex items-end justify-between gap-2">
          <label className="flex flex-col gap-0.5 text-xs text-muted">
            {t("research.maxLabel")}
            <input
              type="number"
              min={1}
              max={50}
              value={max}
              onChange={(e) => setMax(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
              className="h-8 w-20 border border-line bg-surface px-2 text-sm text-ink"
            />
          </label>
          <Button type="submit" variant="primary" disabled={topic.trim() === "" || start.isPending}>
            <Search aria-hidden="true" className="size-3.5" />
            {start.isPending ? t("research.starting") : t("research.start")}
          </Button>
        </div>
        {start.isError ? (
          <p role="alert" className="text-xs text-danger">
            {(() => {
              const { message, fix } = describeError(start.error, t("common.error"));
              return fix ? `${message} ${fix}` : message;
            })()}
          </p>
        ) : null}
      </form>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {jobs.isPending ? (
          <Loading />
        ) : jobs.isError ? (
          <ErrorState error={jobs.error} />
        ) : jobs.data.length === 0 ? (
          <EmptyState
            icon={<Search className="size-5" />}
            title={t("research.emptyTitle")}
            description={t("research.emptyDescription")}
          />
        ) : (
          <ul aria-label={t("research.listLabel")} className="flex flex-col gap-2">
            {jobs.data.map((j) => (
              <JobRow key={j.id} job={j} onOpenSession={onOpenSession} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
