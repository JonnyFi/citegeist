# ADR 0013: Agent interfaces

Status: accepted. Date: 2026-10-23.

## Context

Agents need to work with a library without a graphical interface.

## Decision

Agents get four interfaces:

- an MCP server with a curated tool set ([ADR 0007](0007-core-process-and-operations.md))
- the CLI `cg`
- a portable skill in the gstack layout (`skills/citegeist`)
- an `AGENTS.md` in the library folder

## Consequences

Agent-added content goes through the inbox ([ADR 0014](0014-agent-content-goes-to-inbox.md)). Agents outside the machine connect as described in [ADR 0015](0015-webhooks.md) and [ADR 0023](0023-remote-mcp-through-a-tunnel.md).
