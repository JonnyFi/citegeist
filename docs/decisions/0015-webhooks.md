# ADR 0015: Webhooks

Status: accepted. Date: 2026-10-23.

## Context

External agents, such as bots on agent platforms, need a way to send items to the library and to receive jobs. Different agents should connect in the same way.

## Decision

External agents connect through generic webhooks that do not depend on one agent. Outgoing, citegeist sends a job with context and a callback address by HTTP POST, signed with HMAC and optionally with the platform's own key in an auth header. Incoming, an endpoint accepts papers and notes and treats them like input over MCP ([ADR 0014](0014-agent-content-goes-to-inbox.md)). The details are in [docs/webhooks.md](../webhooks.md).

## Consequences

Agents that run in the cloud and support remote MCP servers can use the tunnel described in [ADR 0023](0023-remote-mcp-through-a-tunnel.md). Webhooks stay in place beside it.
