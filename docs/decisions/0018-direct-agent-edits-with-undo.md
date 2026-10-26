# ADR 0018: Direct agent edits with undo

Status: accepted. Date: 2026-10-24.

## Context

The first draft of the planning spec let every agent change arrive as a proposal. A user who asks in the chat to word out a passage wants to see it in the document at once.

## Decision

- When a change is requested in the chat, the agent writes directly into the document. This replaces the proposal flow of the first draft for chat requests.
- Every change carries its origin. Every file has a history, and one click reverts a whole agent turn.
- A review mode can be switched on per project (`agent_edits: review`) or per chat. Changes then arrive as proposals with a diff.
- Changes nobody asked for, for example from background jobs or from external agents outside a chat, still arrive as proposals.

## Consequences

Actor, chat turn and review mode decide for every write operation whether it writes directly or creates a proposal. The history of a turn compares the library folder before and after the turn ([ADR 0020](0020-chat-agents-use-the-users-environment.md)).
