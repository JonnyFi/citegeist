import { jobsGet } from "@citegeist/ops";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { useCore } from "./hooks";

/** A background AI job of one card: the paraphrase and core statement being written. */
export interface CardJob {
  jobId: string;
  state: "running" | "failed";
  message?: string | undefined;
  /** `at` of the paraphrase when the job started; a different stamp means the new text is in. */
  baseline?: string | undefined;
}

/**
 * True while the AI texts of a card are being (re)written. The job record can lag a poll behind the
 * card file, so a paraphrase with a newer stamp than at the start ends the pending state at once.
 */
export function isPending(
  job: CardJob | undefined,
  paraphrase: { at: string } | undefined,
): boolean {
  return job?.state === "running" && paraphrase?.at === job.baseline;
}

type Finished = "succeeded" | "failed" | "cancelled";

function JobWatcher({
  jobId,
  onFinished,
}: {
  jobId: string;
  onFinished: (result: Finished, message?: string) => void;
}) {
  const core = useCore();
  const queryClient = useQueryClient();
  const job = useQuery({
    queryKey: ["job", jobId],
    queryFn: () => core.call(jobsGet, { job: jobId }),
    gcTime: 0,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === undefined || status === "queued" || status === "running" ? 600 : false;
    },
  });
  const finished = useRef(onFinished);
  finished.current = onFinished;
  const status = job.data?.status;

  useEffect(() => {
    if (status === "succeeded" || status === "failed" || status === "cancelled") {
      finished.current(status, job.data?.error?.message);
      // the new texts are in the card file now; the change event may be slower than this poll
      void queryClient.invalidateQueries({ queryKey: ["op"] });
    }
  }, [status, job.data?.error?.message, queryClient]);

  useEffect(() => {
    if (job.isError) finished.current("failed", job.error.message);
  }, [job.isError, job.error]);

  return null;
}

/**
 * Tracks the AI jobs started by cards.create and cards.regenerate. A card with a running job shows
 * its pending state; `watchers` must be rendered once to poll jobs.get until each job finishes.
 */
export function useCardJobs(): {
  jobs: Readonly<Record<string, CardJob>>;
  track: (cardId: string, jobId: string, baseline?: string) => void;
  watchers: ReactNode;
} {
  const [jobs, setJobs] = useState<Record<string, CardJob>>({});

  const track = useCallback((cardId: string, jobId: string, baseline?: string) => {
    setJobs((prev) => ({ ...prev, [cardId]: { jobId, state: "running", baseline } }));
  }, []);

  const finish = useCallback(
    (cardId: string, jobId: string, result: Finished, message?: string) => {
      setJobs((prev) => {
        const current = prev[cardId];
        if (!current || current.jobId !== jobId) return prev;
        if (result === "succeeded") {
          const { [cardId]: _done, ...rest } = prev;
          return rest;
        }
        return { ...prev, [cardId]: { jobId, state: "failed", message } };
      });
    },
    [],
  );

  const watchers = Object.entries(jobs)
    .filter(([, job]) => job.state === "running")
    .map(([cardId, job]) => (
      <JobWatcher
        key={job.jobId}
        jobId={job.jobId}
        onFinished={(result, message) => finish(cardId, job.jobId, result, message)}
      />
    ));

  return { jobs, track, watchers };
}
