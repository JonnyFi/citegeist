# Settings and models

Open the settings with Cmd+, or from the navigation rail. They are split into General, Sync, Webhooks and Alerts. [Sync](sync.md), [alerts](literature-search-and-alerts.md#alerts) and [webhooks](../webhooks.md) have their own pages.

## AI backends

citegeist sends AI work to a backend that you choose. Each backend is one of three kinds:

| Kind | Backends |
|---|---|
| Subscription CLI | Claude Code CLI, Codex CLI, Cursor CLI. citegeist runs the command line tool that you installed and logged in to. |
| API key | Anthropic API, OpenAI API, OpenRouter, xAI API. The key is stored in the macOS Keychain. |
| Local | Ollama. |

The settings list each backend with its state (ready, not installed, not logged in, version too old, no key, not reachable) and an install or login hint. "Test" sends a short request and shows the response time. citegeist finds the command line tools in your `PATH` and in `~/.local/bin`, `~/.claude/local`, `/opt/homebrew/bin` and `/usr/local/bin`, because an app started from Finder has a short `PATH`. The tools themselves are not part of citegeist.

| Tool | Install | Log in |
|---|---|---|
| Claude Code | `npm install -g @anthropic-ai/claude-code` | `claude auth login` |
| Codex | `npm install -g @openai/codex` | `codex login` |
| Cursor | Cursor CLI from cursor.com/cli | `agent login` |

## Model, default backend and fallback

The "Model" block at the top of the settings holds three things.

- **Default for AI tasks.** The backend that serves every AI task. The list shows only backends that are installed and logged in, or have a key. This used to be set during onboarding only.
- **Per task.** A collapsed section where each AI task can use its own backend: paraphrase and kind, check quotes, metadata from the first page, link proposals, concept descriptions and names, literature matrix and search queries for the literature search. "Default" removes the entry. `cg settings update` accepts a routing entry for every task name.
- **Fallback order.** A short list of the other ready backends with an on/off box and arrows for the order. By default it holds the subscription CLIs in the order of the backend list. API-key backends, which cost money per call, and Ollama join only when you switch them on.

When the backend of a task reaches its usage or rate limit (Claude Code "usage limit reached" or "5-hour limit", Codex "You've hit your usage limit", Cursor "usage limit", HTTP 429), is overloaded (529, 503) or is logged out, the same call continues on the first active entry of the fallback order. Content problems (an answer that does not fit the schema after one retry), time-outs and cancellations do not fall back. The backend that failed rests until the reset time that the CLI reports, or for 30 minutes (2 minutes when overloaded), and later tasks skip it without trying. The backend list shows "Paused until 14:30" for it, and a successful test ends the pause. Every attempt appears in the usage ledger with its outcome (`AI_USAGE_LIMIT`, `AI_OVERLOADED`, `AI_BACKEND_UNAVAILABLE`). A job that moved on shows "continuing with Cursor, Claude limit reached" in the job list, and a card or text names the backend that wrote it in its stamp.

The chat and the research jobs use the agent that you pick in the chat, and their choice is separate. AI features can be left off, and the classic library works without any of them.

## Usage

Settings > General > Usage shows what the AI calls and agents of this library used in the last 7 or 30 days, by task and by backend: calls, tokens in and out, tokens from cache and the list price. With a subscription, the list price is an estimate of what the same call would cost through the API. Not every backend reports a price, and the summary says how many calls have none. The numbers stay on the Mac. `cg usage` prints the same data.

## Search

**Semantic search** is off by default. Turning it on downloads an embedding model once and runs it locally. Two models are available: EmbeddingGemma 300M (about 325 MB, the default) and Qwen3 Embedding 0.6B (about 640 MB). Switching models downloads the new one and rebuilds the index. The search then combines full text and meaning.

**Re-sort results** adds a reranker (about 570 MB) that reads the best results again. A search takes about one second longer. The reranker is off by default, because on the project's test set it gained little for its cost. See [ADR 0026](../decisions/0026-retrieval-benchmark.md).

## Metadata sources

- **Contact address.** Crossref serves requests that carry an address from its faster pool. citegeist sends the address with metadata lookups.
- **Unpaywall address.** Unpaywall needs an address to look up open PDF versions. Without its own entry, the contact address applies.
- **NCBI tool and API key.** PubMed answers faster with a key.
- **OpenAlex API key.** The literature search reaches the daily OpenAlex limit quickly without a key. A free key is available at openalex.org/settings/api.

Keys are stored in the Keychain.

## Chat agent

The chat agent gets the environment of your own agent: a shell, your MCP servers and your settings. The switch "Isolated agent" removes the shell and your settings and leaves only the citegeist tools. A change applies from the next message of a conversation. Research jobs always run isolated. See [ADR 0020](../decisions/0020-chat-agents-use-the-users-environment.md).

## Research job limits

A research job stops at a limit, ends with an error and keeps what it found so far in the inbox. The defaults are 20 minutes, 200 tool calls and 2 million tokens, and 0 turns a limit off. The token limit is only enforced when the agent reports its usage while it works. A job also ends when the agent makes the same tool call with the same arguments three times in a row. Cancelling a job stops the underlying AI process. See [ADR 0025](../decisions/0025-cancellation-limits-and-usage-ledger.md).

## Conversion worker

The settings show the state of the Python worker: ready, not installed, installing or not reachable. "Install" and "Reinstall" run uv. If uv is missing, the message says `brew install uv`.

## Integrations

- **Zotero Connector.** A local listener for the browser extension, off by default, port 23119.
- **Quick insert.** A hotkey for the card search palette, default Cmd+Shift+K.
- **Webhooks.** Connectors for external and cloud agents. See [webhooks](../webhooks.md).

## Language and appearance

The interface is available in German and English. It follows the preferred language of macOS (German or English, else English) until you choose one. "Theme" switches between light, dark and system.

## Troubleshooting and About

"About citegeist" in the citegeist menu shows the version, the commit of the build, the license (Apache-2.0), the repository, the folder of the open library and the folder with the log. Buttons open the log file and the bundled NOTICE file with the third-party licenses. Settings > General > Troubleshooting shows the same facts and has "Open log".

The app and its core write to `~/Library/Logs/citegeist/core.log`. The file rotates at 5 MB and keeps three files. Tokens and API keys are removed before a line is written.
