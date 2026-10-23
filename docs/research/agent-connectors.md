# citegeist: agent connectors and subscription-backed inference

Research for the architecture phase. Compiled on 2026-10-23.

Premise (owner decision, not researched here): every citegeist user brings their own subscription through the official CLIs (Claude Code, Codex, Cursor), and API keys are an additional option. This document covers only the technical side of that decision.

Evidence tags used throughout:

- **[V]** verified on 2026-10-23 against a primary source (vendor docs, changelog, GitHub source, npm registry, or a local `--help` run).
- **[S]** secondary source only (blogs, forum posts, third-party write-ups).
- **[I]** inference or recommendation by the author of this document.
- **[U]** could not be verified.

Local tool versions on Jonny's machine at the time of writing [V]: Claude Code 2.1.307, Codex CLI 0.162.1 (bundled with Conductor), Cursor Agent CLI 2026.05.16-0338208. Gemini CLI is not installed. Current npm releases on 2026-10-23 [V] ([registry.npmjs.org](https://registry.npmjs.org)): `@anthropic-ai/claude-code` 2.1.309, `@anthropic-ai/claude-agent-sdk` 0.3.309, `@anthropic-ai/sdk` 1.1.0, `@openai/codex` and `@openai/codex-sdk` 0.164.0, `@agentclientprotocol/sdk` 2.0.1, `@agentclientprotocol/claude-agent-acp` 0.94.0, `@agentclientprotocol/codex-acp` 2.2.2, `@modelcontextprotocol/sdk` 1.32.1, `@modelcontextprotocol/server` and `@modelcontextprotocol/client` 2.3.1, `@google/gemini-cli` 0.65.0, `@github/copilot` 1.0.103, `opencode-ai` 1.19.4, `@cursor/sdk` 1.0.40, `ai` (Vercel AI SDK) 7.0.150.

Research limits: the shared web-search budget for this research run ran out midway. Later checks used direct fetches of known primary URLs (docs pages, raw GitHub files, the npm registry) and local `--help` output. Items that needed a search and could not get one are tagged [U].

## 0. Summary

- **Claude** has the strongest programmatic surface. The TypeScript Agent SDK has official warm-start APIs: `startup()` pre-spawns the CLI and completes the initialize handshake before a prompt exists, and `prewarm()` (alpha) holds a spare process that is claimed later [V]. Structured output works through `outputFormat` (SDK) or `--json-schema` (CLI). `--bare` is the fastest `-p` mode but reads only API keys, never the subscription login [V].
- **Codex** exposes `codex exec --json` (JSONL events) with `--output-schema`, a TypeScript SDK (`@openai/codex-sdk` 0.164.0) and a long-lived JSON-RPC `codex app-server` with a daemon mode [V for flags; details of the event schema partly U]. `codex mcp-server` no longer exists in 0.162.1 [V].
- **Cursor** has `agent -p --output-format stream-json` with a documented event schema, a native ACP mode (`agent acp`) and a new `@cursor/sdk` [V]; the SDK's API is [U].
- **ACP** is a good fit for the chat sidebar only. It has no structured output, its TypeScript SDK broke its API in 2.0 four days ago, and the Claude adapter loads the user's personal `~/.claude` config unless told otherwise [V].
- **MCP**: the current spec revision is 2026-07-28 (stateless redesign), and TypeScript SDK v2 (`@modelcontextprotocol/server`) is stable [V]. Claude Code, Codex and Cursor all connect to a local stdio server and to `http://127.0.0.1:PORT/mcp`; Claude Desktop needs stdio or an `.mcpb` bundle [V].
- **Recommendation** (section 8): one `InferenceBackend` interface with two call shapes (`complete` for schema-bound single shots, `session` for agentic work); the Agent SDK with a pre-warmed process for the highlighter and extraction, ACP for the chat sidebar, local embeddings (voyage-4-nano or EmbeddingGemma), and citegeist exposed as MCP server plus CLI plus one portable skill. The latency claims are hypotheses with a measurement plan, because no prompt was run during this research.

## 1. Claude Code headless and the Agent SDK

### 1.1 `claude -p` flags (Claude Code 2.1.307, local `--help`) [V]

| Flag | What it does |
|---|---|
| `-p, --print` | Non-interactive run. Skips the workspace trust dialog; "Settings files that fail validation are silently ignored in this mode". |
| `--output-format text\|json\|stream-json` | `json` = one result object; `stream-json` = realtime events. |
| `--input-format text\|stream-json` | `stream-json` = realtime streaming input on stdin (long-lived process). |
| `--include-partial-messages` | Partial message chunks (needs `stream-json`). |
| `--replay-user-messages` | Echo stdin user messages back on stdout (both formats `stream-json`). |
| `--json-schema <schema>` | Structured output; the result carries a `structured_output` field. |
| `--mcp-config <configs...>`, `--strict-mcp-config` | Load MCP servers from files or JSON strings; strict = ignore every other MCP config. |
| `--allowedTools`, `--disallowedTools` | Allow or deny rules such as `"Bash(git *) Edit"`. |
| `--tools <tools...>` | Restrict the built-in tool set; `""` disables all built-in tools. |
| `--permission-mode` | `acceptEdits`, `auto`, `bypassPermissions`, `manual`, `dontAsk`, `plan`. |
| `--permission-prompts host\|none` | Who answers prompts in `-p`: the SDK host or `--permission-prompt-tool`, or nobody (auto-deny). |
| `--model`, `--fallback-model`, `--effort` | Model alias (`fable`, `opus`, `sonnet`) or full name; fallback list; effort `low` to `max`. |
| `--max-budget-usd` | Spend cap for `-p`. `--max-turns` is hidden from `--help` but still supported (changelog entries reference it) [V]. |
| `--system-prompt`, `--append-system-prompt` (and `-file` variants) | Replace or extend the default system prompt. |
| `--system-prompt-snapshot on\|off` | Record the system prompt once per conversation and reuse it verbatim. |
| `--exclude-dynamic-system-prompt-sections` | Move cwd, env, git status out of the system prompt into the first user message (better cache reuse). |
| `-r/--resume`, `-c/--continue`, `--session-id`, `--fork-session`, `--no-session-persistence` | Session control. |
| `--setting-sources user,project,local` | Which settings files load. |
| `--disable-slash-commands` | Disable all skills and commands. |
| `--bare` | Minimal mode: skips hooks, LSP, plugin sync, auto-memory, keychain reads and CLAUDE.md discovery. "Anthropic auth is strictly ANTHROPIC_API_KEY or apiKeyHelper via --settings (OAuth and keychain are never read)." |
| `--restricted` | Removes code-running tools and WebFetch, ignores user/project/local settings, confines file tools to the working directories. |
| `--safe-mode` | All customizations off, auth and built-in tools normal. |

Headless docs ([code.claude.com/docs/en/headless](https://code.claude.com/docs/en/headless)) [V]:

- Without `--bare`, "`claude -p` discovers and loads [hooks, skills, plugins, MCP servers, CLAUDE.md] as an interactive session would, including anything configured in the working directory or `~/.claude`."
- "`--bare` is the recommended mode for scripted and SDK calls, and will become the default for `-p` in a future release." Since bare mode never reads the subscription login, a subscription-backed integration must pin the Claude Code version and re-test when that default flips [I].
- Structured output: "use `--output-format json` with `--json-schema` ... with the structured output in the `structured_output` field." "If a run ends without valid structured output, for example because Claude declined the request, the response has no `structured_output` field." `format` keywords are accepted but not enforced.
- The `system/init` event "reports session metadata including the model, tools, MCP servers, and loaded plugins". With `--mcp-config`, Claude Code waits for pending servers before the first turn, up to `MCP_TIMEOUT` (30 s default); invalid entries are skipped and reported in `mcp_server_errors`.
- Retry events carry `retry_delay_ms` and an `error` category: `authentication_failed`, `oauth_org_not_allowed`, `account_on_hold`, `billing_error`, `rate_limit`, `overloaded`, `invalid_request`, `model_not_found`, `server_error`, `max_output_tokens`, `cloud_credential_error`, `unknown`. citegeist should map these to UI states.
- SIGTERM exits with 143 and leaves the turn unfinished; use SIGINT or the SDK's `interrupt()` to end a turn cleanly.

Startup without `--bare` but with a subscription [I, flags V]: `--setting-sources ""` (or a fixed list), `--strict-mcp-config --mcp-config <citegeist only>`, `--tools ""` or a short list, `--disable-slash-commands`, `--exclude-dynamic-system-prompt-sections`, `--no-session-persistence`, and a dedicated working directory without `.mcp.json` or `.claude/`. This approximates bare mode while still reading the Keychain login.

### 1.2 Auth mechanics [V]

From the [authentication docs](https://code.claude.com/docs/en/authentication): credential precedence is cloud provider variables, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_API_KEY`, `apiKeyHelper`, `CLAUDE_CODE_OAUTH_TOKEN`, Anthropic profiles, then the `/login` subscription credential. "In non-interactive mode (`-p`), the key is always used when present." On macOS the login is in the Keychain (fallback `~/.claude/.credentials.json`, mode 0600); `CLAUDE_CONFIG_DIR` switches to a different Keychain entry. `claude setup-token` prints a one-year OAuth token for `CLAUDE_CODE_OAUTH_TOKEN` ("It can only make model requests"); bare mode does not read it. `claude auth status` reports the active method.

[I] citegeist consequence: to use the user's subscription, spawn `claude` with `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` and `CLAUDE_CODE_OAUTH_TOKEN` removed from the child environment; to use an API key, pass it explicitly and add `--bare` for speed.

### 1.3 Agent SDK for TypeScript (`@anthropic-ai/claude-agent-sdk` 0.3.309) [V]

Source: [TypeScript reference](https://code.claude.com/docs/en/agent-sdk/typescript) and [overview](https://code.claude.com/docs/en/agent-sdk/overview). The SDK is "A library that runs the Claude Code binary"; it ships a bundled native binary per platform.

- `query({ prompt: string | AsyncIterable<SDKUserMessage>, options })` returns a `Query`, an async generator of `SDKMessage`.
- **Warm start**: `startup({ options, initializeTimeoutMs })` "Pre-warms the CLI subprocess by spawning it and completing the initialize handshake before a prompt is available"; the returned `WarmQuery` accepts the prompt later, "so the first `query()` call resolves without paying subprocess spawn and initialization cost inline." `prewarm()` (alpha, SDK 0.3.282 or later) starts a spare process before the working directory is known and binds it with `claim()`. "A spare holds roughly 230 to 260 MB of memory while it waits." Options such as `mcpServers`, `hooks`, `canUseTool`, `settingSources`, `systemPrompt` and `plugins` "[are] fixed for the life of the spare, so keep one spare per distinct set of those options."
- **Streaming input mode** (prompt as `AsyncIterable`) keeps one process for many turns and unlocks `interrupt()`, `setModel()`, `setPermissionMode()`, `applyFlagSettings()` (e.g. `effortLevel`), `streamInput()`, `supportedModels()`, `mcpServerStatus()`, `setMcpServers()`, `getContextUsage()`, `accountInfo()`, `close()`.
- **Structured output**: `outputFormat: { type: 'json_schema', schema }`; the result message carries `structured_output`, and failure has subtype `error_max_structured_output_retries`. Result messages also report `modelUsage` and `terminal_reason`.
- **In-process tools**: `createSdkMcpServer({ name, tools })` with `tool(name, description, zodSchema, handler, annotations?)`; tools appear as `mcp__<server>__<tool>`.
- **Settings isolation**: `settingSources` defaults to "CLI defaults (all sources)"; pass `[]` to skip user, project and local settings. Without this, a user's personal `~/.claude` setup leaks into citegeist runs.
- The `/core` entry point exports `query()`, `startup()`, `tool()`, `createSdkMcpServer()` but not `prewarm()`.
- Session helpers: `listSessions()`, `getSessionMessages()`, `forkSession()`, `renameSession()`, `tagSession()`.

Single-shot structured call on a pre-warmed process [I, API names V]:

```ts
import { startup } from "@anthropic-ai/claude-agent-sdk";

const QUOTE = { type: "object", additionalProperties: false, required: ["paraphrase", "faithful"],
  properties: { paraphrase: { type: "string" }, faithful: { type: "boolean" } } };

let spare = startup({ options: {
  model: "haiku", tools: [], settingSources: [], maxTurns: 1,
  systemPrompt: "Paraphrase the passage for a citation note. Keep claims, numbers and hedges.",
  outputFormat: { type: "json_schema", schema: QUOTE },
  cwd: scratchDir, env: subscriptionEnv() } });

export async function paraphrase(passage: string) {
  const warm = await spare;
  spare = startup({ /* same options */ });           // refill the pool off the critical path
  for await (const m of warm.query(passage)) if (m.type === "result") return m.structured_output;
}
```

### 1.4 Prompt caching and latency notes [V]

- Claude Code requests a one-hour cache TTL for the main conversation on a subscription and five minutes with an API key; `CLAUDE_CODE_PROMPT_CACHE_TTL` / `promptCacheTtl` override it. Switching model or effort mid-session invalidates the cache, except effort changes on Opus 5.5, Sonnet 5.5, Haiku 5.5 and Fable 5.1 ([prompt caching](https://code.claude.com/docs/en/prompt-caching)).
- Local spawn cost on Jonny's Mac, measured on 2026-10-23 without any model call: `claude --version` 7 ms median, `claude --help` 50 ms, `codex --version` 19 ms, `cursor-agent --version` 319 ms [V]. These are lower bounds only; real session initialization (settings, plugins, MCP connections, auth) and time to first token were not measured, because running prompts was out of scope [U].
- Published cold-start and first-token figures for `claude -p` could not be collected before the search budget ran out [U].

### 1.5 Agent SDK vs `claude -p` vs ACP

| | Agent SDK (TS) | `claude -p` subprocess | ACP via `claude-agent-acp` |
|---|---|---|---|
| Warm process | `startup()`, `prewarm()`, streaming input | `--input-format stream-json` keeps one process; no prewarm API | One adapter process, many sessions; each session is an SDK query inside the adapter |
| Structured output | `outputFormat`, typed result | `--json-schema`, `structured_output` | None in the protocol |
| Custom tools | In-process SDK MCP server | `--mcp-config` only | Client-supplied MCP servers in `session/new` |
| Permission UX | `canUseTool` callback, hooks | `--permission-prompt-tool` or `--permission-prompts none` | `session/request_permission` (standard UI) |
| Swap to Codex, Cursor, Gemini | No | No | Yes, same client code |
| Dependency | Node, SDK pins a CLI build | Installed `claude` binary | Node 22+, adapter plus SDK |

[I] Use the SDK for citegeist's own AI functions (highlighter, extraction), ACP for the vendor-neutral chat sidebar, and plain `claude -p` only as a fallback for environments without Node.

## 2. OpenAI Codex

The Codex sub-research stopped early on a rate limit, so this section rests on local `--help` output of Codex CLI 0.162.1, the npm registry and the ACP research [V where tagged].

- **`codex exec`** [V, local help]: `--json` ("Print events to stdout as JSONL"), `--output-schema <FILE>` ("JSON Schema file describing the model's final response shape"), `-o/--output-last-message <FILE>`, `-m/--model`, `-s/--sandbox read-only|workspace-write|danger-full-access`, `--approve-for-me`, `--dangerously-bypass-approvals-and-sandbox`, `-C/--cd`, `--add-dir`, `--skip-git-repo-check` (needed outside a git repo, so needed for citegeist's scratch folder), `--ephemeral` (no session files), `--ignore-user-config` (skip `$CODEX_HOME/config.toml`, auth still from `CODEX_HOME`), `--ignore-rules`, `-c key=value` overrides (e.g. `-c model_reasoning_effort="low"`), `-p/--profile`, `--oss --local-provider lmstudio|ollama`, and subcommands `resume`, `fork`, `review`. Prompt from argument or stdin; piped stdin plus a prompt is appended as a `<stdin>` block. The top-level CLI adds `-a/--ask-for-approval on-request|never` and `--search` (native `web_search` tool).
- **Event schema** [U]: the exact JSONL event names (e.g. `thread.started`, `turn.started`, `item.*`, `turn.completed` with usage) could not be verified against current docs; check `codex app-server generate-json-schema` output or the SDK types before coding against them. Strict JSON-schema rules for `--output-schema` (e.g. `additionalProperties: false`) are also [U].
- **`codex app-server`** [V, local help]: "[experimental] Run the app server", transports `stdio://` (default), `unix://PATH`, `ws://IP:PORT`; WebSocket auth `--ws-auth capability-token|signed-bearer-token`; subcommands `daemon` ("Manage the local app-server daemon"), `proxy` (stdio bridge to the running daemon's control socket), `generate-ts` and `generate-json-schema` (typed protocol bindings). The top-level `codex --remote ws://...|unix://` and `codex agents` ("Browse all agent sessions on the shared local app-server daemon") use the same daemon, and `--no-daemon` opts out. The app-server README in the repo documents thread methods (`thread/start`, `thread/resume`, `thread/fork`, `turn/start`, `turn/completed`, thread attachments, MCP OAuth login, MCP config reload) ([README](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md)) [V, partial].
- [I] The daemon is the warm-session answer for Codex: one long-lived process, a new thread per citegeist task, and `generate-ts` for typed bindings. `codex-acp` already builds on the app-server, which confirms it as the integration surface.
- **`codex mcp-server`** is gone from 0.162.1: the command list has no such subcommand and `codex mcp` now only manages external servers (`list|get|add|remove|login|logout`) [V]. When it was removed is [U].
- **TypeScript SDK**: `@openai/codex-sdk` 0.164.0 (2026-10-23), versioned in lockstep with the CLI [V]. Its API surface (thread start, run, streamed run, output schema) is [U] in this research. Community wrappers for the Vercel AI SDK exist: `ai-sdk-provider-codex-cli` 2.3.0 and `ai-sdk-provider-codex-app-server` 1.1.7 [V, npm].
- **Auth mechanics** [V, local help]: `codex login` (browser), `--device-auth`, `--with-api-key` and `--with-access-token` (both read from stdin), `codex login status`. Adapters read `CODEX_API_KEY` (wins) and `OPENAI_API_KEY` [V, codex-acp README].
- **MCP client config** (from the MCP sub-research, [config reference](https://learn.chatgpt.com/docs/config-file/config-reference)) [V]: `~/.codex/config.toml` `[mcp_servers.<name>]` with `command`/`args`/`env` or `url`, `bearer_token_env_var`, `http_headers`, `startup_timeout_sec` (default 10), `tool_timeout_sec` (default 60), `enabled_tools`, `disabled_tools`, `default_tools_approval_mode = auto|prompt|writes|approve`; CLI `codex mcp add <NAME> (--url <URL> | -- <COMMAND>...)` with `--bearer-token-env-var`.

## 3. Cursor CLI

The Cursor sub-research also stopped on a rate limit. Sources: local `--help` of 2026.05.16 (the registry lists 2026.10.19, so the local build is old) and the [output-format reference](https://cursor.com/docs/cli/reference/output-format) [V].

- **Headless**: `agent -p` / `--print` "Has access to all tools, including write and shell"; `--output-format text|json|stream-json`; `--stream-partial-output` (text deltas, `stream-json` only); `--mode plan|ask` (read-only modes); `-f/--force` or `--yolo`; `--sandbox enabled|disabled`; `--approve-mcps`; `--trust` (trust the workspace without prompting, headless only); `--workspace <path>`; `--model`, `--list-models`; `--resume [chatId]`, `--continue`, `create-chat` (returns a chat ID); `--plugin-dir`; `-w/--worktree` [V].
- **`json` output**: one `{"type":"result","subtype":"success","duration_ms":...,"duration_api_ms":...,"result":"<full assistant text>","session_id":"<uuid>"}`; "Deltas and tool events are not emitted" [V].
- **`stream-json`**: events `{"type":"system","subtype":"init",...,"session_id"}`, `{"type":"user","message":{"content":[{"type":"text",...}]}}`, `{"type":"assistant","message":{"content":[...]}}`, `{"type":"tool_call","subtype":"started"|"completed","tool_call":{...}}`, and a terminal `result`. "On failure, the process exits with a non-zero code and the stream may end early without a terminal event; an error message is written to stderr" [V]. citegeist must treat a missing `result` event plus non-zero exit as failure.
- **No structured output flag** in the CLI [V, help]; schema tasks need prompt-level JSON plus validation [I].
- **Auth mechanics**: `agent login` (browser; `NO_OPEN_BROWSER` disables opening), `--api-key` or `CURSOR_API_KEY`, `agent status --format json` [V].
- **MCP**: reads `.cursor/mcp.json` and `~/.cursor/mcp.json`; `agent mcp list|list-tools|login|enable|disable` [V]. Format in section 7.
- **ACP**: native `agent acp` ([docs](https://cursor.com/docs/cli/acp)) [V]. Whether it honors `mcpServers` from `session/new` is [U].
- **SDK**: `@cursor/sdk` 1.0.40 (2026-10-20), "TypeScript SDK for Cursor agents", depends on Connect RPC and protobuf [V, npm]; docs and API are [U].
- Startup: `cursor-agent --version` alone takes about 0.32 s on Jonny's Mac [V, local measurement], so per-call spawning adds noticeable overhead before any model work.

## 4. Agent Client Protocol (ACP)

### 4.1 Version, governance, SDKs

- Wire protocol: `protocolVersion: 1`, stable. Features arrive as capabilities, not version bumps: "Clients and Agents **MUST** treat all capabilities omitted in the `initialize` request as **UNSUPPORTED**" ([initialization](https://agentclientprotocol.com/protocol/v1/initialization.md)) [V]. The newest v1 schema release is `schema-v1.26.0` (2026-10-16), the ninth release in three months ([releases](https://github.com/agentclientprotocol/agent-client-protocol/releases)) [V].
- ACP v2 is a draft since 2026-07-20 (`schema-v2.0.0-alpha.9`). The announcement says "Don't ship it by default in production" and "Adding v2 support should not mean dropping v1" ([v2 draft](https://agentclientprotocol.com/announcements/acp-v2-draft.md)) [V]. v2 removes the client fs, terminal and modes APIs ("Use client-provided MCP servers when the Agent needs Client-side tools") and ends a turn through a `state_update` notification instead of the `session/prompt` response ([migration](https://agentclientprotocol.com/protocol/v2/migration.md)) [V].
- Governance: "jointly governed by Zed and JetBrains ... while working toward transitioning to an independent foundation" ([governance](https://agentclientprotocol.com/community/governance.md)) [V]. Apache 2.0.
- Transport: stdio with newline-delimited JSON-RPC only; "The agent **MUST NOT** write anything to its `stdout` that is not a valid ACP message" ([transports](https://agentclientprotocol.com/protocol/v1/transports.md)) [V]. Streamable HTTP is a draft.
- TypeScript SDK: `@agentclientprotocol/sdk` 2.0.1 (2026-10-22), successor of the deprecated `@zed-industries/agent-client-protocol` [V]. 2.0.0 (2026-10-19) is breaking: "AgentSideConnection, ClientSideConnection, Agent, Client, LegacyAgentFactory, createLegacyAgent ... have been removed. Use agent()/client() apps and peer-context request()/notify() calls" ([CHANGELOG](https://raw.githubusercontent.com/agentclientprotocol/typescript-sdk/main/CHANGELOG.md)) [V]. Exports include `ndJsonStream`, `client`, `agent`, `methods`, `PROTOCOL_VERSION`, `RequestError`. Entry points: the root for stable v1, `/unstable` for `systemPrompt`, fork and providers, `/experimental/v2` for the draft. Zod 3.25+ or 4 is a peer dependency. Most tutorials on the web still show the removed 1.x classes.
- Other SDKs: Rust `agent-client-protocol` 3.5.0 (three major versions between June and October 2026), Python 0.12.1 with 1.0.0rc3, Kotlin, Java, and a Go SDK by Coder [V].

Minimal client with the 2.x builder API, adapted from the SDK's own [client example](https://raw.githubusercontent.com/agentclientprotocol/typescript-sdk/main/src/examples/client.ts) [V, adapted]:

```ts
import * as acp from "@agentclientprotocol/sdk";
const stream = acp.ndJsonStream(Writable.toWeb(proc.stdin!), Readable.toWeb(proc.stdout!) as ReadableStream<Uint8Array>);
await acp.client({ name: "citegeist" })
  .onRequest(acp.methods.client.session.requestPermission, (ctx) => askUser(ctx.params))
  .connectWith(stream, async (ctx) => {
    await ctx.request(acp.methods.agent.initialize, {
      protocolVersion: acp.PROTOCOL_VERSION, clientCapabilities: { auth: { terminal: true } } });
    return ctx.buildSession({ cwd: workspaceDir, mcpServers: [libraryServer] })
      .withSession(async (s) => {
        s.prompt("Find recent papers on X and add them to the library");
        for (;;) { const m = await s.nextUpdate(); if (m.kind === "stop") return m.response; render(m.update); }
      });
  });
```

### 4.2 Agents that speak ACP (October 2026)

Registry versions come from the official index, fetched on 2026-10-23 ([registry.json](https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json), 43 entries) [V].

| Agent | How it speaks ACP | Login over ACP |
|---|---|---|
| Claude Code | Adapter `@agentclientprotocol/claude-agent-acp` 0.94.0 (2026-10-19). Built on `@anthropic-ai/claude-agent-sdk` and runs the SDK's bundled native `claude` binary. Needs Node 22 or later. Predecessors `@zed-industries/claude-code-acp` and `@zed-industries/claude-agent-acp` are superseded. ([repo](https://github.com/agentclientprotocol/claude-agent-acp)) | Terminal auth methods `claude-ai-login` (runs the bundled CLI with `--cli auth login --claudeai`) and `console-login`, offered only if the client sets `clientCapabilities.auth.terminal`. The launch flag `--hide-claude-auth` removes subscription login and refuses such turns, so citegeist must not pass it. ([source](https://github.com/agentclientprotocol/claude-agent-acp/blob/main/src/acp-agent.ts)) |
| Codex | Adapter `@agentclientprotocol/codex-acp` 2.2.2 (2026-10-10). "It starts the Codex App Server, translates ACP requests into Codex operations". No native ACP mode in Codex found. ([README](https://github.com/agentclientprotocol/codex-acp)) | Methods `api-key`, `chat-gpt` (browser), `chat-gpt-device-code` (needs URL elicitation), `gateway`. Env vars `CODEX_API_KEY` (wins) and `OPENAI_API_KEY`. Reuse of an existing `codex login` is likely, based on the source [I]. |
| Cursor | Native: `agent acp` ([docs](https://cursor.com/docs/cli/acp)) | `cursor_login`, or `agent login`, `--api-key`, `CURSOR_API_KEY` beforehand |
| Gemini CLI | Native `--acp` (`--experimental-acp` is deprecated), 0.65.0 | See section 5: Google consumer logins no longer work in Gemini CLI |
| GitHub Copilot CLI | Native `copilot --acp` (stdio, or TCP with `--port`), public preview ([docs](https://docs.github.com/en/copilot/reference/acp-server)) | GitHub login or BYOK |
| OpenCode, Goose, Kimi CLI, Kiro CLI, Auggie, Qwen Code, Mistral Vibe, Docker Agent | Native ACP subcommands or flags (`opencode acp`, `goose acp`, `kimi acp`, `kiro-cli acp`, `--acp`, `vibe-acp`, `docker agent serve acp`) | Each agent's own providers |

The registry also lists Junie, Cline, Factory Droid, Devin, Grok Build, Google Antigravity (`agy_acp_server`), Poolside, Amp and pi [V].

### 4.3 ACP Registry

- Stable since 2026-03-09 ([announcement](https://agentclientprotocol.com/announcements/acp-agent-registry-stabilized.md)) [V]. Curated, "including only the ones that support authentication"; CI checks that each agent returns valid `authMethods` ([registry repo](https://github.com/agentclientprotocol/registry)) [V].
- Index URL: `https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json` with `{version: "1.0.0", agents: [...], extensions: []}`, refreshed hourly from npm, PyPI and GitHub releases [V].
- Entry fields ([FORMAT.md](https://github.com/agentclientprotocol/registry/blob/main/FORMAT.md)): `id, name, version, description, repository, website, authors, license, icon, distribution`, where `distribution` is `binary` (per platform such as `darwin-aarch64`, with `archive`, `cmd`, `args`, `env`, optional `sha256`), `npx` or `uvx` (`package`, `args`, `env`) [V]. `.dmg` and `.pkg` archives are not supported.
- A client picks its platform entry and runs `npx <package>`, `uvx <package>`, or downloads, verifies and runs `cmd`. [I] For citegeist this means an "add agent" picker can come straight from the registry instead of a hard-coded list.

### 4.4 Protocol details that matter for citegeist (v1 stable unless marked)

- **`initialize`**: the client sends `protocolVersion`, `clientCapabilities` (`fs.readTextFile`, `fs.writeTextFile`, `terminal`, `auth.terminal`, `elicitation {form, url}`, `session.configOptions.boolean`, and others) and `clientInfo`. The agent answers with `agentCapabilities` (`loadSession`, `promptCapabilities {image, audio, embeddedContext}`, `mcpCapabilities {http, sse}`, `sessionCapabilities {list, resume, close, delete, additionalDirectories}`), `agentInfo` and `authMethods` [V].
- **Auth**: `authMethods[]` with `type: "agent"` (client calls `authenticate {methodId}`) or `type: "terminal"` (client relaunches its configured agent command interactively with the method's `args` and `env`; "the Client **MUST NOT** send an `authenticate` request for a terminal method") ([authentication](https://agentclientprotocol.com/protocol/v1/authentication.md)) [V]. Error `-32000` means auth required. The registry docs and the spec disagree on whether terminal-auth args replace or append to the default args [V].
- **`session/new {cwd, mcpServers, additionalDirectories?}`**: both `cwd` and `mcpServers` are required; `cwd` "**MUST** be an absolute path" ([session setup](https://agentclientprotocol.com/protocol/v1/session-setup.md)) [V]. MCP server entries: stdio `{name, command, args, env: [{name, value}]}` (every agent must support it), `{type: "http", name, url, headers: [{name, value}]}` (if `mcpCapabilities.http`), and the deprecated `sse` variant. "Agents **SHOULD** connect to all MCP servers specified by the Client."
- **Session lifecycle**: `session/load` replays history as `session/update` notifications; `session/resume` "**MUST NOT** replay"; `session/list`, `session/close`, `session/delete` are stable; `session/fork` is unstable [V].
- **`session/prompt {sessionId, prompt: ContentBlock[]}`**: blocks `text`, `image`, `audio`, `resource`, `resource_link`; `stopReason` is `end_turn`, `max_tokens`, `max_turn_requests`, `refusal` or `cancelled` ([prompt turn](https://agentclientprotocol.com/protocol/v1/prompt-turn.md)) [V].
- **`session/update` variants**: `user_message_chunk`, `agent_message_chunk`, `agent_thought_chunk`, `tool_call`, `tool_call_update`, `plan`, `available_commands_update`, `current_mode_update`, `config_option_update`, `session_info_update`, `usage_update`, `notice`, plus compaction updates [V].
- **Tool calls**: `toolCallId`, `name`, `title`, `kind` (`read`, `edit`, `delete`, `move`, `search`, `execute`, `think`, `fetch`, `switch_mode`, `other`), `status` (`pending`, `in_progress`, `completed`, `failed`), `content` (`content`, `diff {path, oldText, newText}`, `terminal {terminalId}`), `locations`, `rawInput`, `rawOutput` ([tool calls](https://agentclientprotocol.com/protocol/v1/tool-calls.md)) [V].
- **Plans**: entries with `content`, `priority` (`high|medium|low`), `status` (`pending|in_progress|completed`); each update replaces the whole plan [V].
- **Modes and models**: `session/set_mode` still works but "will be removed"; the preferred path is `configOptions` (`category: mode|model|model_config|thought_level|_custom`) changed with `session/set_config_option` ([config options](https://agentclientprotocol.com/protocol/v1/session-config-options.md)) [V].
- **Cancellation**: `session/cancel` is a notification, and the client "**MUST** respond to all pending `session/request_permission` requests with the `cancelled` outcome"; `$/cancel_request` cancels any pending request [V].
- **Unstable in v1** (only in `schema.unstable.json`): `session/fork`, `providers/*`, `mcp/message` (MCP over the ACP connection), `systemPrompt` on `session/new` (added in 1.26.0), per-turn usage, subagents [V].
- **Extensibility**: `_meta` on most types (keys `traceparent`, `tracestate`, `baggage` reserved), and `_`-prefixed custom methods ([extensibility](https://agentclientprotocol.com/protocol/v1/extensibility.md)) [V].

`session/new` with citegeist's library server, and a permission round trip (shapes from the spec; values substituted) [V]:

```json
{"jsonrpc":"2.0","id":1,"method":"session/new","params":{
  "cwd":"/Users/jonny/Library/Application Support/citegeist/agent-workspace",
  "mcpServers":[{"type":"http","name":"citegeist-library","url":"http://127.0.0.1:41414/mcp",
                 "headers":[{"name":"Authorization","value":"Bearer <per-launch token>"}]}]}}
{"jsonrpc":"2.0","id":1,"result":{"sessionId":"sess_abc123def456"}}

{"jsonrpc":"2.0","id":5,"method":"session/request_permission","params":{
  "sessionId":"sess_abc123def456","toolCall":{"toolCallId":"call_001"},
  "options":[{"optionId":"allow-once","name":"Allow once","kind":"allow_once"},
             {"optionId":"reject-once","name":"Reject","kind":"reject_once"}]}}
{"jsonrpc":"2.0","id":5,"result":{"outcome":{"outcome":"selected","optionId":"allow-once"}}}
```

### 4.5 Can a research library be an ACP client?

Yes for the chat sidebar, no for the highlighter and typed-connection extraction [I]. ACP has no structured-output field, so single-shot schema tasks belong on the direct CLI or SDK paths (sections 1 and 2). Pitfalls, with the mitigation in each line:

1. **`cwd` is mandatory and agents treat it as a project.** The closest precedent, Alchemy (a local-first macOS research notebook), uses "a per-notebook scratch dir under app data, never the LanceDB dir: the agent's own file tools operate there, and notebook content stays reachable only through our MCP tools" ([RFC](https://github.com/thrashr888/alchemy/blob/main/docs/RFC-acp-agents.md)) [V]. citegeist should do the same, with an `AGENTS.md` and `CLAUDE.md` in that folder that tell the agent where it is.
2. **Not advertising `fs` or `terminal` sandboxes nothing.** The spec only forbids the agent from calling the client's fs methods; Claude Code's own Read, Edit and Bash still touch the disk directly (from adapter source reading) [I]. The library must be reachable only through MCP tools, and file and shell tools should be denied.
3. **No standard tool filter.** Per-agent knobs exist: claude-agent-acp reads `_meta.claudeCode.options` on `session/new` (`tools`, `disallowedTools`, `settingSources`, `strictMcpConfig`, `maxTurns`, `maxBudgetUsd`); codex-acp reads `INITIAL_AGENT_MODE=read-only` and `CODEX_CONFIG`; Cursor has `ask` and `plan` modes; Copilot uses launch flags `--available-tools` and `--excluded-tools` [V].
4. **The user's personal agent config leaks in.** claude-agent-acp defaults to `settingSources: ["user","project","local"]`, so Jonny's `~/.claude` instructions, skills and plugins would apply inside citegeist sessions unless citegeist overrides `settingSources` [V, from source].
5. **System prompt injection is unstable.** `systemPrompt {mode: "append"|"override", content}` needs the `/unstable` import; claude-agent-acp supports both modes, codex-acp only `append` ([RFD](https://agentclientprotocol.com/rfds/client-system-prompt.md)) [V]. Fallback used by the Obsidian Agent Client: prepend short instructions to the first prompt.
6. **Permission requests block until answered.** "If your client does not answer permission requests, tool execution can block" ([Cursor ACP docs](https://cursor.com/docs/cli/acp)) [V]. Auto-allow citegeist's own MCP tools, reject shell and edit, answer `cancelled` on cancel.
7. **Auth failures look like transport failures** (Alchemy) [V]. Implement terminal auth in an embedded terminal or Terminal.app and render `authMethods` in the UI.
8. **Process lifecycle on macOS.** GUI apps do not inherit the shell `PATH`; Alchemy hit a `CLAUDECODE` environment leak when the app was launched from a Claude Code terminal [V]. Resolve binaries by absolute path, scrub the environment, drain stderr, kill the process group on quit, and run one agent process with several sessions.
9. **Churn.** The TS SDK went from 1.0 to 2.0 in four months and the Claude adapter shipped 93 releases between 2026-03-26 and 2026-10-19 [V]. Pin versions and test upgrades.

Other non-editor ACP clients worth reading: Obsidian Agent Client ([repo](https://github.com/RAIT-09/obsidian-agent-client)), marimo (which recommends "`marimo pair`, which gives agent CLIs like Claude Code full access to your running notebook from the terminal" as the default, [docs](https://docs.marimo.io/guides/editor_features/agents/)), DeepChat and others in the [clients list](https://agentclientprotocol.com/get-started/clients.md) [V].

Unverified [U]: whether Cursor's `agent acp` honors `mcpServers` from `session/new` (its docs mention only `.cursor/mcp.json`), and whether the bundled `claude` binary in the adapter always shares the `claude` CLI login (Obsidian's docs suggest it does).

## 5. Gemini CLI

- `@google/gemini-cli` 0.65.0 (2026-10-20) [V, npm]; native ACP via `--acp` (`--experimental-acp` deprecated) [V, ACP research].
- Google's developer blog says that "On June 18, 2026, Gemini CLI ... will stop serving requests for Google AI Pro and Ultra" and that "Gemini CLI will remain accessible via paid Gemini ... API keys", as part of a move to the Antigravity CLI ([Google](https://developers.googleblog.com/an-important-update-transitioning-gemini-cli-to-antigravity-cli/)) [V]. Technically this removes Gemini CLI from the "bring your own subscription" set; Antigravity has an ACP server in the registry (`agy_acp_server`) whose subscription behavior is [U].
- Headless flags (`-p`, `--output-format json|stream-json`, approval modes) were not verified in this run [U].

## 6. xAI Grok and webhooks

The Grok and webhook sub-research stopped on a rate limit before reporting. Everything in 6.1 and 6.2 is [I] or [U] and needs a check against [docs.x.ai](https://docs.x.ai) and the vendors' pages before use.

### 6.1 Grok [U]

- xAI's API is OpenAI-compatible and offers server-side search tools for the web and for X posts; the Vercel AI SDK has `@ai-sdk/xai` 5.0.29 [V, npm only]. Model names, tool names, Responses API support and prices are [U].
- The registry lists "Grok Build" as an ACP agent [V], so a Grok-based agent can also drive the chat sidebar through ACP.
- What "connecting a Grok bot via webhook" can mean for citegeist [I]:
  1. citegeist calls the xAI API itself as one more `complete`/`session` backend, mainly for X-post search, which none of the subscription CLIs cover.
  2. An external Grok agent posts results (paper links, summaries) to a citegeist inbound webhook, which turns them into library commands with actor `agent:grok`.
  3. A remote agent calls citegeist's MCP server through a tunnel. This needs OAuth or a bearer token on the public endpoint and is the riskiest option.

### 6.2 Webhook ingress and egress for a desktop app [I]

- **Ingress**: a desktop app has no stable public address. Options are a tunnel (Tailscale Funnel, Cloudflare Tunnel, ngrok) that exposes a local port, or a small cloud relay (for example a Cloudflare Worker with a Durable Object or queue) that stores events while the Mac sleeps and that citegeist drains over an outbound WebSocket or by polling. Limits and prices of each are [U]. For a laptop that sleeps, the relay is the more reliable choice, because a tunnel drops events while the Mac is offline.
- **Security**: verify an HMAC-SHA256 signature over the raw body plus a timestamp, reject timestamps outside about five minutes, compare in constant time, deduplicate by event ID, and rotate secrets with overlapping validity. The Standard Webhooks spec (`webhook-id`, `webhook-timestamp`, `webhook-signature` headers) packages these rules [U, spec not re-read].
- **Egress**: sign outbound payloads the same way, retry with exponential backoff and an idempotency key, and block private and loopback targets to avoid SSRF.
- **Claude Code channels** [V]: "A channel is an MCP server that pushes events into your running Claude Code session" (research preview, installed as a plugin; Telegram, Discord and iMessage included) ([channels](https://code.claude.com/docs/en/channels)). A citegeist channel could forward inbound webhook events into a running Claude session; this only works while that session is open.

## 7. MCP, plugins and skills

Folded in from the MCP sub-research; all items [V] against the linked pages unless tagged.

### 7.1 Spec status

- Current revision: **2026-07-28** ("The **current** protocol version is **2026-07-28**", [versioning](https://modelcontextprotocol.io/specification/versioning)). The release post: "MCP is transforming from a bidirectional stateful protocol into a request/response stateless protocol" ([post](https://blog.modelcontextprotocol.io/posts/2026-07-28/)). It removes the `initialize` handshake and `Mcp-Session-Id`, adds `server/discover`, multi round-trip results for elicitation, `subscriptions/listen`, required `Mcp-Method`/`Mcp-Name` headers, and cacheable list results with `ttlMs`.
- Earlier revisions: 2025-03-26 (Streamable HTTP, OAuth 2.1, tool annotations), 2025-06-18 (structured tool output, elicitation, resource links, servers as OAuth resource servers), 2025-11-25 (URL-mode elicitation, tool calling in sampling, Client ID Metadata Documents, experimental tasks, icons).
- Feature status in 2026-07-28: local HTTP servers "**SHOULD** bind only to localhost (127.0.0.1)" and "**MUST** validate the `Origin` header"; HTTP+SSE, Sampling, Roots, Logging and Dynamic Client Registration are deprecated; tasks moved to the extension `io.modelcontextprotocol/tasks`; MCP Apps (SEP-1865, `io.modelcontextprotocol/ui`, `ui://` resources, `text/html;profile=mcp-app`) is final; structured output (`outputSchema` plus `structuredContent`) accepts any JSON Schema 2020-12. For stdio, auth implementations "**SHOULD NOT** follow this specification, and instead retrieve credentials from the environment".
- MCP Apps render in Claude (web and Desktop), ChatGPT, Cursor, VS Code Copilot, Goose and others, not in the Claude Code terminal [I from Claude Code docs].
- [I] Consequences: keep cross-call state in explicit IDs passed as tool arguments; return job handles for slow work (Codex defaults to 60 s per tool call, claude.ai and Desktop allow about 240 s); do not rely on sampling for citegeist's own AI.

### 7.2 TypeScript SDK

`@modelcontextprotocol/server` and `/client` 2.3.1 (2026-10-05) are the stable v2 line, released 2026-07-27, implementing 2026-07-28; v1 (`@modelcontextprotocol/sdk` 1.32.1) gets fixes "for at least six months after the v2 release" ([README](https://github.com/modelcontextprotocol/typescript-sdk)). v2 needs Node 20 and Zod 4.2+, `registerTool(name, config, handler)` replaces `.tool()`, and `serveStdio` plus `createMcpHandler` serve old and new protocol eras from one factory. `@modelcontextprotocol/node` provides `toNodeHandler`, `localhostHostValidation` and `localhostOriginValidation`.

### 7.3 Connecting clients to a local citegeist server

Placeholder paths: shim `/Applications/Citegeist.app/Contents/MacOS/citegeist-mcp`, HTTP `http://127.0.0.1:PORT/mcp`.

Claude Code ([MCP docs](https://code.claude.com/docs/en/mcp)); scopes `local` and `user` live in `~/.claude.json`, `project` in `.mcp.json`; tool search is on by default ("Only tool names and server instructions load at session start"); `MAX_MCP_OUTPUT_TOKENS` defaults to 25,000; server instructions are cut at 4,096 characters:

```bash
claude mcp add --scope user citegeist -- /Applications/Citegeist.app/Contents/MacOS/citegeist-mcp --stdio
claude mcp add --transport http --scope user citegeist-http http://127.0.0.1:PORT/mcp --header "Authorization: Bearer <token>"
```
```json
{ "mcpServers": {
    "citegeist": { "command": "/Applications/Citegeist.app/Contents/MacOS/citegeist-mcp", "args": ["--stdio"] },
    "citegeist-http": { "type": "http", "url": "http://127.0.0.1:PORT/mcp",
                        "headers": { "Authorization": "Bearer ${CITEGEIST_TOKEN}" } } } }
```

Codex (`~/.codex/config.toml`):

```toml
[mcp_servers.citegeist]
command = "/Applications/Citegeist.app/Contents/MacOS/citegeist-mcp"
args = ["--stdio"]
tool_timeout_sec = 120

[mcp_servers.citegeist_http]
url = "http://127.0.0.1:PORT/mcp"
bearer_token_env_var = "CITEGEIST_TOKEN"
default_tools_approval_mode = "writes"
```

Cursor (`~/.cursor/mcp.json` or `.cursor/mcp.json`; interpolation `${env:NAME}`; supports tools, prompts, resources, roots, elicitation and MCP Apps, [docs](https://cursor.com/docs/context/mcp)):

```json
{ "mcpServers": {
    "citegeist": { "type": "stdio", "command": "/Applications/Citegeist.app/Contents/MacOS/citegeist-mcp", "args": ["--stdio"] },
    "citegeist-http": { "url": "http://127.0.0.1:PORT/mcp",
                        "headers": { "Authorization": "Bearer ${env:CITEGEIST_TOKEN}" } } } }
```

Claude Desktop: `~/Library/Application Support/Claude/claude_desktop_config.json` with stdio entries, or an `.mcpb` bundle (zip of a stdio server plus `manifest.json`, built with `@anthropic-ai/mcpb`). Remote connectors "are accessed through Anthropic's infrastructure", so a `127.0.0.1` URL cannot be a custom connector [I]. Whether the config file accepts `url` entries is [U]; `mcp-remote` is the usual stdio bridge.

| | Claude Code | Codex | Cursor | Claude Desktop |
|---|---|---|---|---|
| Local stdio | yes | yes | yes | yes (config or MCPB) |
| HTTP on 127.0.0.1 | yes | yes | yes | not as connector [I] |
| Elicitation | form and URL | configurable | yes | [U] |
| MCP Apps | not rendered [I] | not documented | yes | yes |
| Resources, prompts | yes | not documented | yes | yes |
| Deferred tool definitions | default | likely [I] | yes | [U] |

[I] Every citegeist tool should return a readable text block next to `structuredContent`, because structured output handling is undocumented in most clients.

### 7.4 Skills and plugins

- Agent Skills ([spec](https://agentskills.io/specification)): a folder with `SKILL.md` (frontmatter `name`, `description`, optional `license`, `compatibility`, `metadata`, `allowed-tools`) plus `scripts/`, `references/`, `assets/`; 46 clients listed, including Claude Code, Codex, Cursor, Gemini CLI, Copilot, VS Code and OpenCode. Locations: Claude Code `~/.claude/skills/<name>/`; Codex `~/.agents/skills`; Cursor `~/.agents/skills` and `~/.cursor/skills` (it also reads `.claude/skills`). Cursor requires `name` to match the folder name.
- Plugins: Claude Code uses `.claude-plugin/plugin.json` with `skills/`, `commands/`, `agents/`, `hooks/`, `.mcp.json`, `bin/`, and marketplaces in `.claude-plugin/marketplace.json` (`/plugin marketplace add owner/repo`). Codex (`codex plugin add`, `codex plugin marketplace add`) and Cursor accept the vendor-neutral Agent Plugins 1.0.0 layout (root `plugin.json`, launched 2026-08-06) and also read Claude-compatible manifests. Claude Code support for Agent Plugins is [U].
- Skills over MCP (`io.modelcontextprotocol/skills`) exist but Claude, Cursor and Codex do not list support.
- A CLI can prompt Claude Code users to install its plugin by printing `<claude-code-hint v="1" type="plugin" value="..."/>` to stderr when `CLAUDECODE` is set, but only for plugins in an official Anthropic marketplace ([CLI hints](https://code.claude.com/docs/en/plugins/cli-hints)).

### 7.5 CLI plus skill vs MCP

- Anthropic measured tool definitions dropping "from 150,000 tokens to 2,000 tokens" with code execution ([post](https://www.anthropic.com/engineering/code-execution-with-mcp)) and tool search cutting about 77K to 8.7K tokens ([advanced tool use](https://www.anthropic.com/engineering/advanced-tool-use)). Claude Code's cost guide still says CLI tools "are still more context-efficient than MCP servers because they don't add any per-tool listing" ([costs](https://code.claude.com/docs/en/costs)). Cursor reported 46.9 % fewer agent tokens after deferring MCP tool descriptions.
- [I] With deferred loading in Claude Code and Cursor, the upfront cost of a 10-tool MCP server is small. The CLI keeps an advantage for bulk work, because the agent can filter output before it enters the context. GUI clients (Claude Desktop, claude.ai, ChatGPT) can only use MCP.

## 8. Recommended inference architecture

### 8.1 Rules [I]

1. **One library core, many callers.** UI, MCP server, CLI and webhook receiver all call the same command layer. Every write records an actor (`human`, `agent:<client>:<session>`), so agents and humans are equal users with provenance and undo.
2. **Two call shapes.** `complete` for schema-bound single shots (paraphrase, classify, extract typed connections). `session` for multi-turn, tool-using work (chat, research jobs).
3. **citegeist never handles vendor credentials.** It spawns the official binaries with a scrubbed environment, checks login with `claude auth status`, `codex login status` and `agent status --format json`, and shows the vendor's own login flow (terminal auth in ACP) when needed.
4. **Isolation.** Every spawned agent runs in a citegeist scratch directory with its own `AGENTS.md`/`CLAUDE.md`, `settingSources: []` or `--ignore-user-config`, only the citegeist MCP server, and file and shell tools denied unless a task needs them.

### 8.2 Adapter interface (sketch) [I]

```ts
type Effort = "low" | "medium" | "high";
interface CompleteRequest<T> { system: string; input: string; schema: JSONSchema; model?: string; effort?: Effort; signal?: AbortSignal }
interface CompleteResult<T> { data: T; raw: string; usage?: Usage; backend: string; latencyMs: { spawn: number; firstToken?: number; total: number } }

interface SessionOptions { cwd: string; system?: string; mcpServers: McpServerRef[]; allowTools: string[]; model?: string }
type AgentEvent =
  | { type: "text"; delta: string } | { type: "thought"; delta: string }
  | { type: "tool_call"; id: string; name: string; status: "pending" | "running" | "done" | "failed"; input?: unknown }
  | { type: "plan"; entries: { content: string; status: string }[] }
  | { type: "permission"; id: string; tool: string; options: string[] }
  | { type: "usage"; data: Usage } | { type: "done"; stopReason: string } | { type: "error"; kind: string; message: string };

interface InferenceBackend {
  id: "claude-sdk" | "claude-cli" | "codex" | "cursor" | "acp:<agent>" | "anthropic-api" | "openrouter" | "ollama";
  caps: { structured: "native" | "prompted"; warm: boolean; mcp: boolean; webSearch: boolean };
  health(): Promise<{ ok: boolean; loggedIn: boolean; detail?: string }>;
  complete<T>(req: CompleteRequest<T>): Promise<CompleteResult<T>>;
  session(opts: SessionOptions): Promise<{ send(text: string): AsyncIterable<AgentEvent>; answer(permissionId: string, option: string): void; cancel(): void; close(): void }>;
}
```

The `AgentEvent` union maps onto ACP `session/update` (section 4.4), Agent SDK messages, Codex app-server items and Cursor `stream-json` events. Prompted structured output (Cursor, ACP agents, Ollama) validates against the schema and retries once.

### 8.3 Backend per task class

| Task class | Example | Primary | Alternatives | Latency expectation |
|---|---|---|---|---|
| Fast single shot | Paraphrase a highlight into a citable quote | Agent SDK, `startup()` pool of 1 to 2 warm processes, small model, `tools: []`, `outputFormat` | API key path (`@anthropic-ai/sdk` with structured outputs, `claude --bare -p`), `codex exec --output-schema` | [I] warm SDK: a few seconds, dominated by the model call; cold `claude -p`: adds process and session initialization on top. Not measured. |
| Structured extraction | Typed connections between two papers | Agent SDK `outputFormat` with a strict schema, medium model | `codex exec --output-schema`, API key path | [I] 5 to 30 s depending on input length |
| Interactive chat | Sidebar conversation over the library | ACP client to `claude-agent-acp`, `codex-acp`, `agent acp` (user picks), citegeist MCP server in `session/new` | Agent SDK streaming input directly | [I] first text after a few seconds once the adapter process is warm |
| Long research job | Search papers, summarize, add to library | Agent SDK session in the background (or Codex app-server thread) with web search plus citegeist MCP tools that return job handles | ACP session | minutes |
| Embeddings | Semantic search, related papers | Local model (8.6) | Voyage API | milliseconds per chunk locally |

### 8.4 Warm sessions [I, APIs V]

- **Claude**: keep one `startup()` handle per option set (model, schema, tool set) and refill it after each use, so each highlight gets a fresh, short context and none of the spawn and initialize cost. Use `prewarm()` when the working directory is unknown at boot. A spare costs about 230 to 260 MB, so cap the pool at one or two. For multi-turn chat, use streaming input mode and `setModel()` / `applyFlagSettings()` instead of new processes; keep model and effort fixed mid-session to preserve the prompt cache.
- **Codex**: one app-server daemon, one thread per task; spawn `codex exec` only as a fallback.
- **ACP**: one adapter process per agent, many sessions; restart on crash with backoff.
- **Cursor**: no warm API known; `create-chat` plus `--resume` keeps conversation state but every call still spawns a process [U for `@cursor/sdk`].

### 8.5 Fallbacks [I]

- **API keys** (user-supplied): Anthropic API via `@anthropic-ai/sdk` 1.1.0 with `output_config.format` structured outputs; Claude Haiku 5.5 is listed at $0.10 per million input and $0.50 per million output tokens for prompts up to 100K tokens, Sonnet 5.5 at $2 / $10 ([pricing](https://platform.claude.com/docs/en/about-claude/pricing)) [V]. With an API key, `claude --bare -p` is the fast CLI path.
- **OpenRouter**: one OpenAI-compatible key for many models; "there is no markup on inference pricing" ([FAQ](https://openrouter.ai/docs/faq)) [V]; it also has an embeddings endpoint ([docs](https://openrouter.ai/docs/api-reference/embeddings)) [S].
- **Local**: Ollama exposes OpenAI-compatible and Anthropic-compatible (`/v1/messages`) endpoints; the Anthropic layer lacks `tool_choice`, prompt caching, token counting and PDF blocks ([docs](https://docs.ollama.com/api/anthropic-compatibility)) [V]. MLX via LM Studio or `mlx-lm` is [U] here.
- The Vercel AI SDK (`ai` 7.0.150) can host the API and local backends behind one interface (`@ai-sdk/anthropic`, `@openrouter/ai-sdk-provider`, `ollama-ai-provider-v2`), and community providers wrap the CLIs (`ai-sdk-provider-claude-code` 4.3.3, `@mcpc-tech/acp-ai-provider` 0.3.9) [V, npm]. The community providers are unofficial; `ai-sdk-provider-claude-code` notes that its `startup()` helper "does not compose with `generateText`/`streamText`" [V], so the warm Claude path should use the Agent SDK directly.

### 8.6 Embeddings [V unless tagged]

None of the subscription CLIs offers an embeddings endpoint, and "Anthropic does not offer its own embedding model" ([embeddings](https://platform.claude.com/docs/en/build-with-claude/embeddings)).

- **Local default** [I]: `voyage-4-nano` (0.3B parameters, Apache 2.0, 32K context, 256 to 2048 dimensions, GGUF for Ollama and llama.cpp; its embeddings "can be directly compared and used interchangeably" with the hosted voyage-4 models) ([model card](https://huggingface.co/voyageai/voyage-4-nano)). Alternatives on Ollama: `embeddinggemma` (622 MB), `qwen3-embedding` (639 MB to 4.7 GB), `nomic-embed-text`, `bge-m3`.
- **Hosted option**: Voyage gives "The first 200 million tokens" free for the voyage-4 family, then $0.02 (lite) to $0.12 (large) per million tokens ([pricing](https://docs.voyageai.com/docs/pricing)). Because nano shares the voyage-4 embedding space, citegeist can mix local document vectors with hosted query vectors.
- **Paper-level similarity**: the Semantic Scholar Graph API returns SPECTER embeddings; "Specify `embedding.specter_v2` to select v2 embeddings" ([API spec](https://api.semanticscholar.org/graph/v1/swagger.json)).
- **Storage** [I]: `sqlite-vec` 0.1.9 next to the library's SQLite file, or LanceDB 0.40.0 for larger corpora [V, npm versions].

### 8.7 Exposing citegeist to agents [I]

1. **MCP server** as the primary surface: a stdio shim in the app bundle that forwards to the running app over a local socket (the app stays the single writer), plus an optional Streamable HTTP endpoint on 127.0.0.1 with Host/Origin checks and a per-launch bearer token. Built on `@modelcontextprotocol/server` 2.x. About ten tools (`search_library`, `get_item`, `add_paper`, `add_note`, `add_summary`, `link_items`, `get_highlights`, `import_status`, ...), `readOnlyHint`/`idempotentHint` set, text plus `structuredContent`, `resource_link` for full texts, job handles for slow imports.
2. **`citegeist` CLI** over the same core for shell agents and bulk work.
3. **One portable skill** (`skills/citegeist/SKILL.md`, spec-only frontmatter) that tells agents to use MCP when connected and the CLI otherwise, shipped as a Claude Code plugin with an Agent Plugins manifest beside it.
4. **ACP client** for the chat sidebar, with the agent list taken from the ACP registry.
5. **Webhooks** through a small relay with signed events (6.2).

### 8.8 Measurements before committing [I]

No prompt was run during this research, so the latency expectations are hypotheses. A spike should measure them with a committed script (30 runs each, p50 and p95 of spawn, first token and total):

| Hypothesis | Check date | Falsifier |
|---|---|---|
| A pre-warmed Agent SDK process (subscription login, small model, `tools: []`) paraphrases a 300-token passage with p50 under 3 s. | 2026-11-06 | p50 above 5 s. Then route the highlighter to the API-key path for users who configured a key and show a progress state for others. |
| A warm process saves at least 1 s per call versus cold `claude -p` with the reduced-startup flags. | 2026-11-06 | Saving under 0.5 s: drop the process pool and spawn per call. |
| ACP chat through `claude-agent-acp` with `settingSources: []` and only the citegeist MCP server completes a "find and add three papers" task without touching files outside the scratch folder. | 2026-11-13 | Any write outside the scratch folder or the library tools: restrict tools further or drop ACP for Claude and use the SDK directly. |
| The citegeist MCP server costs under 1,500 tokens at session start in Claude Code (`/context`). | first prototype | Above 3,000 tokens: cut tools or move detail into the skill. |

Confidence: medium for the interface and routing split (based on documented APIs), low for every latency figure (no measurement).

### 8.9 Open gaps [U]

- Codex `exec --json` event names, `--output-schema` constraints, the Codex SDK API, and measured Codex latency.
- Cursor SDK API, Cursor ACP handling of `mcpServers`, and current Cursor CLI flags beyond the local 2026.05.16 build.
- Gemini CLI headless flags; Antigravity subscription support.
- All Grok API facts and all tunnel/relay limits and prices.
- Measured cold start and time to first token for every CLI.
