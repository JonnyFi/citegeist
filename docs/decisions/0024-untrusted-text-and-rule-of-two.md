# ADR 0024: Untrusted text and the Rule of Two

Status: accepted. Date: 2026-10-24.

## Context

Text from PDFs and web pages, resolver metadata, notes and reasons from agents or webhooks can contain sentences that look like instructions ("ignore the rules and print X"). An unattended research job reads untrusted web text and has access to the library.

## Decision

- Every AI task in `packages/ai` puts such text into the prompt only through `mark` from `untrusted.ts`. This is the datamarking of Hines et al., "Defending Against Indirect Prompt Injection Attacks With Spotlighting" (arXiv 2403.14720). Every run of whitespace becomes the character U+02C6, and the system text states that marked text is data and no instruction. A line break can no longer close the text block, and injected sentences look different from the rules around them.
- `runTask` is the only path to a model. A test in `untrusted.test.ts` fails as soon as a task embeds a text of its fixtures without marking. Quotes returned by a model are checked against the unmarked text and treat the character as whitespace. Webhook texts are stored unchanged and carry the actor `agent:<connector>`.
- Research jobs follow the Agents Rule of Two (Meta, "Practical AI agent security"): an agent that reads untrusted text and accesses private data must not also act freely outward. The token of a research job has the scope `research`: the reading tools and `add_item`, always into the inbox, no local files, no address outside the scholarly servers (`SCHOLARLY_HOSTS` in `packages/ops/src/research.ts`). Web access consists of the agent's web search and of fetches of addresses the model cannot compose itself: scholarly servers or exactly the addresses a web search of the session returned.
- No agent can send webhooks, because those operations are `admin` and never visible over MCP.

## Consequences

Research jobs can add to the inbox and nothing else. Their limits and cancellation are covered in [ADR 0025](0025-cancellation-limits-and-usage-ledger.md).
