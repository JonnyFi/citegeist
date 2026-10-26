# ADR 0029: AI backend switch and fallback

Status: accepted. Date: 2026-10-26.

## Context

Every AI task is routed by `ai.routing` to one backend. The default could only be changed in onboarding, the settings had no visible default switch, and when a subscription ran into its limit the task failed. Users who hold two subscriptions (for example Claude Code and Cursor) want work to continue on the second one and want to choose the default themselves.

## Decision

- **Settings:** `ai.routing` is edited in the settings (default select, collapsed per-task section, only ready backends). The new setting `ai.fallback` is an ordered list of backend ids. Unset, it reads as the subscription CLIs in catalog order. API-key backends and Ollama join only when the user adds them. An empty list switches the fallback off.
- **Classification:** `classifyFailure` in `@citegeist/ai` sorts a backend error into `limit`, `overloaded`, `auth` or `other` from the error code, the HTTP status and the message text. The strings come from the shipped Claude Code and Codex binaries and from Cursor's documentation; the tests keep them. Only the first three trigger a fallback. Schema errors after the retry, time-outs, cancellations and refusals never do.
- **Router:** `AiRouter.run` walks the chain (routed backend, then the fallback list) for one task call, checks the abort signal before every attempt and writes one usage record per attempt, with the classified error code in the ledger.
- **Pauses:** `BackendHealth` remembers a failed backend until the reset time that the message names, otherwise for 30 minutes (limit, login) or 2 minutes (overload). It lives in the runtime, outside the router, so a settings change does not forget it. If every backend is paused, the chain is tried in order anyway, because a pause can be stale. A successful test or a changed key ends a pause.
- **Feedback:** the job scope carries a `note` function. When the router moves a task on, the job message becomes `ai-fallback:<from>:<to>:<reason>`, which the job list renders as a sentence. Cards need no new row, because their stamp already names the backend that wrote the text. `settings.get` adds `paused` to each backend.
- **Chat:** the chat keeps its own agent choice.

## Consequences

A used-up subscription no longer stops AI work as long as another backend is ready. The default fallback holds only subscription CLIs, so a limit hit never turns into API costs unless the user adds a key backend to the list. The router tries a missing or logged-out CLI once (cheap) and then pauses it. Pauses are in memory, so after a restart the first call finds out again.
