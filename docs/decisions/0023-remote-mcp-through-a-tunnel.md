# ADR 0023: Remote MCP through a tunnel

Status: accepted. Date: 2026-10-24.

## Context

An agent that runs in the cloud cannot reach a local MCP server. Such agents often support remote MCP servers over HTTP. Webhooks ([ADR 0015](0015-webhooks.md)) cover agents without MCP.

## Decision

- citegeist serves `/mcp` with Streamable HTTP on the fixed hooks port that `/hooks/<name>` already uses. A tunnel (Tailscale Funnel or Cloudflare Tunnel) exposes both paths. The tool set and implementation are the same as in `cg mcp`.
- The core port stays private. The hooks listener serves these two paths only.
- The user switches access on per webhook connector. Each connector gets its own token (shown once, kept in the keychain), compared in constant time. Repeated failed attempts end in `429`. If no connector has MCP access, `/mcp` answers `404`.
- The actor is `agent:<connector>`, new items go to the inbox ([ADR 0014](0014-agent-content-goes-to-inbox.md)), `admin` operations are blocked, and no local files of the Mac are readable.
- Webhooks remain: outbound jobs to trigger agents (with the platform's auth header) and inbound requests from agents without MCP (signature or, when enabled, a bearer token).
- The public address of the tunnel is a setting and survives launching the app from the Dock. The environment variable overrides it.

## Consequences

Cloud agents work with the same tools as local ones. The hooks listener is the only part of the core that is reachable from outside.
