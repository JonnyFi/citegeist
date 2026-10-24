import { randomBytes } from "node:crypto";
import { type Actor, CitegeistError } from "@citegeist/schema";

/**
 * Ties an outbound research task to a job. The job id is the task id that travels to the external
 * agent and comes back in its callback, so the callback finds the job without any other state.
 */
export interface TaskInfo {
  id: string;
  connector: string;
  prompt: string;
  project?: string;
  /** False once the job has finished, failed or been cancelled. */
  open: boolean;
}

export interface TaskTracker {
  /** Creates the job and returns its id. */
  create(input: { connector: string; prompt: string; project?: string; by: Actor }): string;
  get(id: string): TaskInfo | undefined;
  /** The callback arrived: the job succeeds with this result. */
  complete(id: string, result: unknown): void;
  /** The task failed or could not be delivered: the job fails with this message. */
  fail(id: string, message: string): void;
}

function failure(message: string): CitegeistError {
  return new CitegeistError({
    code: "WEBHOOK_TASK_FAILED",
    message,
    fix: "Check the connector's logs, then send the task again with webhooks.send.",
    recovery: "fix-and-retry",
  });
}

type Outcome = { ok: true; result: unknown } | { ok: false; message: string };

/**
 * The part of core's `JobQueue` the tracker uses. The tracker registers a handler for the job
 * kind "research" that waits for the callback. The queue keeps one handler per kind, so pass a
 * port of a shared kind (`shareKind` from @citegeist/core) when other code, such as the research
 * jobs of the chat, uses the kind too. `isWebhookTaskInput` tells the jobs of the tracker apart.
 */
export interface JobQueueLike {
  newId(): string;
  enqueue(opts: {
    kind: "research";
    input?: unknown;
    by: Actor;
    id?: string;
    maxAttempts?: number;
  }): { id: string };
  get(id: string): { id: string; kind: string; status: string; input?: unknown } | undefined;
  register(
    kind: "research",
    handler: (ctx: { job: { id: string } }) => Promise<unknown>,
    opts?: { concurrency?: number; maxAttempts?: number },
  ): unknown;
}

const OPEN = new Set(["queued", "running"]);

interface TaskInput {
  webhook: { connector: string; prompt: string; project?: string };
}

function taskInput(input: unknown): TaskInput["webhook"] | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const w = (input as Partial<TaskInput>).webhook;
  if (!w || typeof w.connector !== "string" || typeof w.prompt !== "string") return undefined;
  return w;
}

/** True for the input of a job that `queueTaskTracker` created. */
export function isWebhookTaskInput(input: unknown): boolean {
  return taskInput(input) !== undefined;
}

/** Tracks tasks as jobs in core's job queue. A job waits for its callback for `timeoutMs`. */
export function queueTaskTracker(
  queue: JobQueueLike,
  opts: { timeoutMs?: number } = {},
): TaskTracker {
  const timeoutMs = opts.timeoutMs ?? 24 * 60 * 60 * 1000;
  const waiting = new Map<string, (outcome: Outcome) => void>();
  const early = new Map<string, Outcome>();

  queue.register(
    "research",
    ({ job }) =>
      new Promise((resolve, reject) => {
        const settle = (outcome: Outcome): void => {
          clearTimeout(timer);
          waiting.delete(job.id);
          if (outcome.ok) resolve(outcome.result);
          else reject(failure(outcome.message));
        };
        const timer = setTimeout(
          () => settle({ ok: false, message: "the connector did not call back in time" }),
          timeoutMs,
        );
        timer.unref?.();
        const ready = early.get(job.id);
        if (ready) {
          early.delete(job.id);
          settle(ready);
        } else {
          waiting.set(job.id, settle);
        }
      }),
    { concurrency: 1000, maxAttempts: 1 },
  );

  const deliver = (id: string, outcome: Outcome): void => {
    const settle = waiting.get(id);
    if (settle) settle(outcome);
    else early.set(id, outcome);
  };

  return {
    create({ connector, prompt, project, by }) {
      const webhook = { connector, prompt, ...(project ? { project } : {}) };
      const job = queue.enqueue({ kind: "research", input: { webhook }, by, maxAttempts: 1 });
      return job.id;
    },
    get(id) {
      const job = queue.get(id);
      const task = job?.kind === "research" ? taskInput(job.input) : undefined;
      if (!job || !task) return undefined;
      return { id, ...task, open: OPEN.has(job.status) };
    },
    complete: (id, result) => deliver(id, { ok: true, result }),
    fail: (id, message) => deliver(id, { ok: false, message }),
  };
}

/** Tracker without a job queue, for tests and for a core that runs no background jobs. */
export function memoryTaskTracker(): TaskTracker & {
  outcome(id: string): Outcome | undefined;
} {
  const tasks = new Map<string, TaskInfo>();
  const outcomes = new Map<string, Outcome>();
  return {
    create({ connector, prompt, project }) {
      const id = `j_${randomBytes(10).toString("hex").toUpperCase().slice(0, 20)}`;
      tasks.set(id, { id, connector, prompt, ...(project ? { project } : {}), open: true });
      return id;
    },
    get: (id) => tasks.get(id),
    complete(id, result) {
      const task = tasks.get(id);
      if (task) task.open = false;
      outcomes.set(id, { ok: true, result });
    },
    fail(id, message) {
      const task = tasks.get(id);
      if (task) task.open = false;
      outcomes.set(id, { ok: false, message });
    },
    outcome: (id) => outcomes.get(id),
  };
}
