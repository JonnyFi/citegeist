import { jobsList, parseFallbackNote } from "@citegeist/ops";
import type { Job } from "@citegeist/schema";
import { useQuery } from "@tanstack/react-query";
import { type MessageKey, type Translator, useI18n } from "../i18n";
import { backendShortName } from "../lib/backend-names";
import { useCore } from "../lib/hooks";
import { summarizeJobs } from "../lib/jobs";
import { JobSlot } from "./ui/job-slot";

const RECENT = 30;

/** The message of a job as text: a backend switch becomes "weiter mit Cursor, Claude-Limit erreicht". */
export function jobMessage(t: Translator["t"], message: string): string {
  const note = parseFallbackNote(message);
  return note
    ? t(`job.fallback.${note.reason}` as MessageKey, {
        from: backendShortName(note.from),
        to: backendShortName(note.to),
      })
    : message;
}

function JobRows({ jobs }: { jobs: readonly Job[] }) {
  const { t } = useI18n();
  return (
    <ul className="max-h-80 overflow-y-auto">
      {jobs.map((job) => (
        <li
          key={job.id}
          data-testid="job-row"
          className="flex items-center gap-3 border-b border-line-soft px-4 py-2 last:border-b-0"
        >
          <span className="min-w-0 flex-1 truncate">
            {t(`job.kind.${job.kind}` as MessageKey)}
            {job.message ? (
              <span className="ml-2 text-muted">{jobMessage(t, job.message)}</span>
            ) : null}
          </span>
          <span className="font-mono text-[12px] text-muted">{job.by.replace(/^human$/, "")}</span>
          <span className="w-20 text-right text-[12px] text-muted">
            {t(`job.status.${job.status}` as MessageKey)}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Right end of the top bar: shows the most important background job and opens the list. */
export function JobStatus() {
  const { t, tn } = useI18n();
  const core = useCore();
  const query = useQuery({
    queryKey: ["op", jobsList.name, { limit: RECENT }],
    queryFn: () => core.call(jobsList, { limit: RECENT }),
    refetchInterval: (q) =>
      q.state.data?.jobs.some((j) => j.status === "running" || j.status === "queued")
        ? 1500
        : false,
  });
  const jobs = query.data?.jobs ?? [];
  const summary = summarizeJobs(jobs);

  if (!summary) {
    return <JobSlot label={t("job.idle")} listLabel={t("job.list")} />;
  }

  const kind = t(`job.kind.${summary.main.kind}` as MessageKey);
  const label =
    summary.total > 1
      ? `${kind} ${t("job.of", { done: summary.done, total: summary.total })}`
      : kind;
  return (
    <JobSlot
      label={label}
      progress={summary.progress}
      counter={tn("job.count", summary.active.length)}
      agent={summary.main.kind === "research"}
      list={<JobRows jobs={jobs.slice(0, 12)} />}
      listLabel={t("job.list")}
    />
  );
}
