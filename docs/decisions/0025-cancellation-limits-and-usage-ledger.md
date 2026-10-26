# ADR 0025: Cancellation, limits and usage ledger

Status: accepted. Date: 2026-10-24.

## Context

Cancelling a job used to cancel only its status. The AI call underneath kept running, and `claude -p`, `codex exec` or `agent -p` stayed alive with their child processes. The task API took `timeoutMs` but no abort signal. Unattended research jobs also had no bounds, and there was no record of what AI calls cost.

## Decision

- **Cancellation:** the job queue enters a job scope (`AsyncLocalStorage`) with signal and actor for every handler, and the AI access of the services reads it. CLI backends start the process in its own process group and end the whole group with SIGKILL on a signal or timeout. HTTP backends pass the signal to `fetch`. A cancelled call ends with `AI_CANCELLED`. The agent adapters of research and chat also run in their own group.
- **Research limits** (in the settings, 0 switches a limit off): 20 minutes, 200 tool calls, 2 million tokens. A job also ends when the same tool call with the same arguments repeats three times in a row. It then fails with `RESEARCH_BUDGET_EXCEEDED` or `RESEARCH_LOOP`, and what it found so far stays in the inbox and in `result.added`. The token limit counts the growth of the agent's context during the run and applies only if the adapter sends `usage_update` during the work. The Claude Code adapter sends it once at the end of a turn, so the limit stays unchecked there and the job result says so (`budget.note`). Time and tool calls always apply.
- **Usage ledger:** the table `ai_usage` in `state.sqlite` (machine-local, never synced). Each row holds source (task, chat, research), task, backend, model, tokens for input, output, cache read and cache write, list price in dollars, duration, outcome, actor and job. Where a backend reports no price, the price is missing and the overview states for how many calls. With a subscription the price is an estimate at API list price. `usage.summary` (read access, `cg usage`) groups by day, task and backend, and the settings show 7 and 30 days.

## Consequences

Cancel stops the paid work. Research jobs end with a bounded cost, and every AI call shows up in the ledger.
