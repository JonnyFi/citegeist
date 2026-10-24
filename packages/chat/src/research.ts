import type { Actor } from "@citegeist/schema";
import { researchPrompt } from "./prompts.js";
import type { ChatService } from "./service.js";
import { extractCitekey } from "./tools.js";
import { chatError } from "./util.js";

/**
 * The slice of the core's JobQueue that research needs. `JobQueue` from @citegeist/core fits as
 * it is, so this package does not depend on the core.
 */
export interface ResearchJobContext {
  job: { id: string; input?: unknown };
  signal: AbortSignal;
  progress(value: number, message?: string): void;
}

export interface JobQueuePort {
  register(
    kind: "research",
    handler: (ctx: ResearchJobContext) => Promise<unknown>,
    opts?: { concurrency?: number; maxAttempts?: number },
  ): unknown;
  enqueue(opts: { kind: "research"; input?: unknown; by: Actor; maxAttempts?: number }): {
    id: string;
  };
}

export interface ResearchInput {
  prompt: string;
  project?: string | undefined;
  backend?: string | undefined;
  maxItems: number;
}

export interface ResearchResult {
  /** Chat session that holds the transcript of the job. */
  session: string;
  added: Array<{ citekey: string; why?: string }>;
  /** Calls that broke the rules of D7: a paper added straight to the library, or without a reason. */
  violations: string[];
  stopReason?: string | undefined;
}

export function registerResearch(queue: JobQueuePort, service: ChatService): void {
  queue.register(
    "research",
    async (ctx) => {
      const input = ctx.job.input as ResearchInput;
      return runResearch(service, input, ctx);
    },
    // One agent at a time; a research run is not safe to repeat blindly, since it adds papers.
    { concurrency: 1, maxAttempts: 1 },
  );
}

export async function runResearch(
  service: ChatService,
  input: ResearchInput,
  ctx: ResearchJobContext,
): Promise<ResearchResult> {
  const session = service.create({
    kind: "research",
    ...(input.backend ? { backend: input.backend } : {}),
    ...(input.project ? { project: input.project } : {}),
    title: `Research: ${input.prompt.replace(/\s+/g, " ").slice(0, 80)}`,
    job: ctx.job.id,
  });
  const added = new Map<string, { citekey: string; why?: string }>();
  const violations: string[] = [];
  const seen = new Set<string>();

  ctx.progress(0.02, "Starting the agent");
  const turn = await service
    .run(
      session.id,
      researchPrompt({ topic: input.prompt, project: input.project, maxItems: input.maxItems }),
      {
        signal: ctx.signal,
        onEvent(event) {
          if (event.type !== "tool" || event.tool !== "add_item") return;
          if (event.status !== "done" || seen.has(event.callId)) return;
          seen.add(event.callId);
          const args = (event.input ?? {}) as {
            target?: unknown;
            why?: unknown;
            identifier?: unknown;
          };
          const citekey = extractCitekey(event.output) ?? String(args.identifier ?? event.callId);
          // The core answers a duplicate with the existing citekey in `duplicateOf`.
          if (/"duplicateOf"\s*:\s*"/.test(JSON.stringify(event.output ?? ""))) return;
          if (args.target === "library")
            violations.push(`${citekey} was added to the library, not the inbox`);
          const why = typeof args.why === "string" && args.why.trim() ? args.why.trim() : undefined;
          if (!why) violations.push(`${citekey} was added without a reason`);
          added.set(citekey, { citekey, ...(why ? { why } : {}) });
          ctx.progress(
            0.05 + 0.9 * Math.min(1, added.size / input.maxItems),
            `Found ${added.size} of ${input.maxItems}`,
          );
          // Enough papers: stop the agent instead of letting it run on.
          if (added.size >= input.maxItems) service.cancel(session.id);
        },
      },
      // The job is the only turn of this session: end the agent and revoke its token.
    )
    .finally(() => service.end(session.id));

  if (turn.status === "failed") {
    const failure = service
      .get(session.id)
      .entries.filter((e) => e.type === "notice" && e.level === "error")
      .at(-1);
    throw chatError(
      "RESEARCH_FAILED",
      failure?.type === "notice" ? failure.text : "The research agent stopped with an error.",
      failure?.type === "notice" && failure.fix
        ? failure.fix
        : "Open the research session in the chat to see what happened, then start the job again.",
      "retry",
      { session: session.id },
    );
  }
  return {
    session: session.id,
    added: [...added.values()],
    violations,
    stopReason: turn.stopReason,
  };
}
