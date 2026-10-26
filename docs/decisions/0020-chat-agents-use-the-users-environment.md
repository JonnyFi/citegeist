# ADR 0020: Chat agents use the user's environment

Status: accepted. Date: 2026-10-24. Replaces, for chat sessions, the isolation rule in the AI layer section of [docs/architecture.md](../architecture.md) (`settingSources: []`, no shell, only citegeist tools).

## Context

In the first real chat session the agent could not download a PDF, create an issue or call `cg`, because its session ran without a shell, without the user's MCP servers and without the user's Claude Code settings. The isolation was meant to keep a session from loading personal configuration. In the chat the user sits in front of the screen and wants exactly that configuration.

## Decision

- A chat session gets the same environment as the user's own Claude Code. The Claude adapter loads `settingSources` `user` and `project`, the shell is allowed, and the citegeist MCP server is added per session. Codex works with the user's Codex configuration.
- The permission rule of the chat sidebar allows the shell, foreign tools and changes outside the library folder. Inside the library folder, derived data, converted originals and the manifest stay protected.
- The setting "Isolated agent" (`chat.isolated` in `settings.json`) restores the sandbox. It applies from the next message of a running session, when the agent is restarted and briefed again.
- Research jobs and inference tasks (highlighter, metadata, summaries) stay isolated: `settingSources: []`, no shell, and write access only through `add_item` into the inbox.

## Consequences

The history of a turn ([ADR 0018](0018-direct-agent-edits-with-undo.md)) compares the library folder before and after the turn, so it also records changes made by a shell command. Items created over MCP still carry `by: agent:<name>` ([ADR 0014](0014-agent-content-goes-to-inbox.md)).
