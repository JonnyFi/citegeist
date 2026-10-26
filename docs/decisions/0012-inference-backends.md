# ADR 0012: Inference backends

Status: accepted. Date: 2026-10-23.

## Context

AI tasks run through the subscription CLIs of the user ([ADR 0001](0001-open-source-and-own-subscription.md)). The highlighter, which writes a paraphrase for a marked passage, has to feel fast. An inference spike measured the options: no subscription path reached a p50 below 3 seconds. A fresh `claude -p` with Haiku, `--effort low` and thinking switched off was the fastest (p50 4.2 s, p95 5.2 s). A pre-warmed Agent SDK process was slower.

## Decision

- AI runs behind a backend interface with `complete` and `session`. The chat sidebar is an ACP client ([ADR 0020](0020-chat-agents-use-the-users-environment.md)).
- The highlighter works asynchronously with `claude -p` and Haiku as the default, which replaces the earlier default of pre-warmed Agent SDK processes. The card with wording and page appears at once, paraphrase and kind follow a few seconds later.
- New target: the card appears in under 300 ms and the AI texts follow with a p50 below 5 seconds.
- API keys and local models stay selectable for users who want it faster.

## Consequences

Other tasks, such as metadata and summaries, use the same backend interface and can be routed to a different backend per task.
