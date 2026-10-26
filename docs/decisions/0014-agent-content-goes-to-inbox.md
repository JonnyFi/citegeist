# ADR 0014: Agent content goes to the inbox

Status: accepted. Date: 2026-10-23. Replaces the first version of this decision from the same day.

## Context

Agents add papers and notes on their own. The user needs a place to accept or reject these additions, and a way to skip that step when the agent knows exactly which paper is meant.

## Decision

Everything an agent adds lands in the inbox first and carries a provenance mark (`by: agent:<name>`). The MCP tool `add_item` has the parameter `target: "library"`. With it an agent places a paper directly in the library, when it knows which paper is meant or the user tells it to. What the user adds themselves lands directly in the library.

## Consequences

The inbox is the review point for all agent and alert additions ([ADR 0022](0022-literature-search.md)). Research jobs may only write to the inbox ([ADR 0024](0024-untrusted-text-and-rule-of-two.md)).
