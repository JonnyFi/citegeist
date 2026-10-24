import { DEFAULT_RESEARCH_LIMITS } from "@citegeist/ops";
import type { DriverEvent } from "./driver.js";

/** Limits of one research job. Zero switches a limit off. */
export interface ResearchBudget {
  /** Wall-clock time in minutes. */
  maxMinutes: number;
  /** Tokens the run added to the context, as far as the adapter reports usage while it runs. */
  maxTokens: number;
  /** Tool calls of the agent, all tools counted. */
  maxToolCalls: number;
}

export const DEFAULT_RESEARCH_BUDGET: ResearchBudget = { ...DEFAULT_RESEARCH_LIMITS };

/** The same tool call with the same arguments this many times in a row ends the job. */
export const LOOP_REPEATS = 3;

export function resolveBudget(given?: Partial<ResearchBudget> | undefined): ResearchBudget {
  const pick = (value: number | undefined, fallback: number): number =>
    typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
  return {
    maxMinutes: pick(given?.maxMinutes, DEFAULT_RESEARCH_BUDGET.maxMinutes),
    maxTokens: pick(given?.maxTokens, DEFAULT_RESEARCH_BUDGET.maxTokens),
    maxToolCalls: pick(given?.maxToolCalls, DEFAULT_RESEARCH_BUDGET.maxToolCalls),
  };
}

export interface GuardStop {
  code: "RESEARCH_BUDGET_EXCEEDED" | "RESEARCH_LOOP";
  message: string;
  fix: string;
  recovery: "fix-and-retry" | "ask-human";
}

/** JSON with sorted keys, so that two calls with the same arguments give the same text. */
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * Watches the events of a research run and decides when it must stop: wall-clock time, tool
 * calls, tokens (only from the usage updates the adapter sends while it works) and a loop of
 * identical tool calls. It never stops anything itself. `onStop` is called once with the reason.
 */
export class RunGuard {
  private timer: NodeJS.Timeout | undefined;
  private readonly started = Date.now();
  private readonly known = new Map<string, { name: string; input: unknown }>();
  private readonly finished = new Set<string>();
  private recent: string[] = [];
  private contextSeen = 0;
  private stopReason: GuardStop | undefined;
  toolCalls = 0;
  /** Tokens added to the context so far, from usage updates. */
  tokens = 0;
  /** True once the adapter has sent a usage update during the run. */
  sawUsage = false;

  constructor(
    readonly budget: ResearchBudget,
    private readonly onStop: (stop: GuardStop) => void,
  ) {}

  start(): void {
    if (this.budget.maxMinutes <= 0) return;
    this.timer = setTimeout(
      () =>
        this.stop({
          code: "RESEARCH_BUDGET_EXCEEDED",
          message: `The research run used up its time limit of ${minutes(this.budget.maxMinutes)}.`,
          fix: "Raise the time limit for research jobs in the settings, or start the job again with a narrower topic.",
          recovery: "fix-and-retry",
        }),
      this.budget.maxMinutes * 60_000,
    );
    this.timer.unref();
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  get stopped(): GuardStop | undefined {
    return this.stopReason;
  }

  get seconds(): number {
    return Math.round((Date.now() - this.started) / 1000);
  }

  private stop(reason: GuardStop): void {
    if (this.stopReason) return;
    this.stopReason = reason;
    this.dispose();
    this.onStop(reason);
  }

  observe(event: DriverEvent): void {
    if (this.stopReason) return;
    if (event.type === "usage") {
      this.sawUsage = true;
      this.tokens += Math.max(0, event.contextTokens - this.contextSeen);
      this.contextSeen = event.contextTokens;
      if (this.budget.maxTokens > 0 && this.tokens > this.budget.maxTokens) {
        this.stop({
          code: "RESEARCH_BUDGET_EXCEEDED",
          message: `The research run used more than its token limit of ${this.budget.maxTokens} tokens.`,
          fix: "Raise the token limit for research jobs in the settings, or start the job again with a narrower topic.",
          recovery: "fix-and-retry",
        });
      }
      return;
    }
    if (event.type !== "tool") return;

    const prev = this.known.get(event.callId);
    if (!prev) {
      this.toolCalls++;
      if (this.budget.maxToolCalls > 0 && this.toolCalls > this.budget.maxToolCalls) {
        this.stop({
          code: "RESEARCH_BUDGET_EXCEEDED",
          message: `The research run made more than its limit of ${this.budget.maxToolCalls} tool calls.`,
          fix: "Raise the limit for tool calls of research jobs in the settings, or start the job again with a narrower topic.",
          recovery: "fix-and-retry",
        });
        return;
      }
    }
    const entry = {
      name: event.tool ?? event.title,
      input: event.input !== undefined ? event.input : prev?.input,
    };
    this.known.set(event.callId, entry);
    if (event.status !== "done" && event.status !== "failed") return;
    if (this.finished.has(event.callId)) return;
    this.finished.add(event.callId);
    this.checkLoop(entry);
  }

  private checkLoop(entry: { name: string; input: unknown }): void {
    const key = `${entry.name}:${entry.input === undefined ? "" : stableJson(entry.input)}`;
    this.recent.push(key);
    if (this.recent.length > LOOP_REPEATS) this.recent.shift();
    if (this.recent.length === LOOP_REPEATS && this.recent.every((k) => k === key)) {
      this.stop({
        code: "RESEARCH_LOOP",
        message: `The agent made the same call ${LOOP_REPEATS} times in a row: ${entry.name}${
          entry.input === undefined ? "" : ` ${shorten(stableJson(entry.input), 120)}`
        }.`,
        fix: "Open the research session to see where the agent got stuck, then start the job again with a clearer topic.",
        recovery: "ask-human",
      });
    }
  }
}

function minutes(value: number): string {
  return value >= 1 ? `${Math.round(value)} minutes` : `${Math.round(value * 60)} seconds`;
}

function shorten(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 3)}...`;
}
