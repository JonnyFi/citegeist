# ADR 0007: Core process and operations

Status: accepted. Date: 2026-10-23.

## Context

The app, the command line and agents all need the same capabilities. Separate implementations would drift apart.

## Decision

- A dedicated core process (Node, TypeScript) owns the library. The app, the CLI (`cg`) and the MCP server are equal clients of it.
- Every capability is defined once as an operation in `packages/ops`. Each operation appears automatically as an RPC call and a CLI command, and, if curated, as an MCP tool.

## Consequences

The curated MCP tool set is capped at 20 tools, checked in `packages/ops/src/contracts.test.ts`. Capabilities beyond the cap reach agents through CLI commands that come from the same contracts, for example `cg concepts ...` ([ADR 0021](0021-concept-register.md)) and `cg texts ...` ([ADR 0002](0002-writing-in-markdown-with-pandoc.md)).
