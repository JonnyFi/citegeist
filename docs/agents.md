# Connecting agents

An agent reaches citegeist in one of three ways. Agents on your Mac talk to `cg mcp`, the chat in the sidebar needs no setup, and agents in the cloud reach citegeist through a tunnel and a connector. [webhooks.md](webhooks.md) covers connectors, signatures and tunnels in depth, and [security-model.md](security-model.md) describes what each kind of agent may do.

The commands and file formats of the clients come from their documentation (October 2026): [Claude Code](https://code.claude.com/docs/en/mcp), [Cursor](https://cursor.com/docs/context/mcp), [Codex](https://developers.openai.com/codex/mcp) and [Claude Desktop](https://modelcontextprotocol.io/quickstart/user). The start of `cg mcp` from the packaged app and from a checkout is tested in this repository (the server answers `initialize`). The clients themselves were not run through. Check the commands against the version you have installed.

## What an agent gets

- **MCP tools.** Search, reading by page or section, items, cards, notes, links, projects, citations, related works, jobs and the planning tools (outline, planning document, insights). Read-only tools carry `readOnlyHint`. The set is capped at 20 tools, so some areas (concepts, texts, sync) are reached through `cg` instead.
- **`cg`.** Every operation of the app is a command with `--json` output. For bulk work, such as importing 50 DOIs, the command line is cheaper than MCP, because the agent can filter the output before reading it. Exit codes are documented in `cg --help`.
- **A skill.** `skills/citegeist/SKILL.md` tells an agent which channel to use and in what order: search, read by page, add a paper, create a card, link a note, cite.
- **`AGENTS.md` in the library.** citegeist writes and maintains an `AGENTS.md` in the library root. It explains the folder format and the rules: write through `cg` or MCP, note bodies may be edited directly, never edit `derived/` or the wording of a card, and mark new content with `by: agent:<name>`.

Everything an agent adds lands in the inbox with its origin. With `target: "library"`, `add_item` puts a paper straight into the library. See [ADR 0014](decisions/0014-agent-content-goes-to-inbox.md). To put an item that is in the library already into projects, `add_item` takes its `citekey` and `projects` without an identifier; on the command line `cg projects addItems` and `cg projects removeItems` change many items in one call.

## Local agents

An agent on your Mac starts citegeist as a stdio server with `cg mcp`. When the app is running, `cg mcp` forwards to it. Otherwise it opens the library itself. The library comes from `--library <folder>` before `mcp`, then `CITEGEIST_LIBRARY`, then `~/Citegeist`. `--scope read` limits the agent to read-only tools.

The app ships `cg` at `/Applications/citegeist.app/Contents/Resources/bin/cg` (under `~/Applications` when the install could not write to `/Applications`). `install.sh` links it as `~/.local/bin/cg`. When that folder is in your `PATH`, `cg mcp` is enough. GUI programs such as Claude Desktop and Cursor do not inherit the `PATH` of your shell, so use the full path in their configuration. The command runs the app's own program as Node and needs no Node on the Mac.

From a checkout, use the absolute path of the checkout (`<repo>` below):

```sh
<repo>/apps/cli/node_modules/.bin/tsx <repo>/apps/cli/src/bin.ts mcp
```

This needs a `pnpm install` in the checkout first. The examples below use the installed app. When you work from a checkout, replace `cg` with the two paths above.

### Claude Code

```sh
claude mcp add --scope user citegeist -- /Applications/citegeist.app/Contents/Resources/bin/cg mcp
```

The `--` separates the options of Claude Code from the start command of the server. `--scope user` makes the entry available in all projects. `claude mcp list` shows whether the server is connected.

### Cursor

Add the server to `~/.cursor/mcp.json` (global) or to `.cursor/mcp.json` in a project:

```json
{
  "mcpServers": {
    "citegeist": {
      "command": "/Applications/citegeist.app/Contents/Resources/bin/cg",
      "args": ["mcp"]
    }
  }
}
```

### Codex

This command writes the entry to `~/.codex/config.toml`:

```sh
codex mcp add citegeist -- /Applications/citegeist.app/Contents/Resources/bin/cg mcp
```

You can also write the entry into the file yourself:

```toml
[mcp_servers.citegeist]
command = "/Applications/citegeist.app/Contents/Resources/bin/cg"
args = ["mcp"]
```

### Claude Desktop

Open Settings > Developer > Edit Config. The file is `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "citegeist": {
      "command": "/Applications/citegeist.app/Contents/Resources/bin/cg",
      "args": ["mcp"]
    }
  }
}
```

Quit Claude Desktop completely and start it again. As an alternative you can build the `.mcpb` bundle with `node skills/citegeist/mcpb/build.mjs`. Its launcher looks for `cg` in `/Applications/citegeist.app/Contents/Resources/bin`, `~/.local/bin`, `/opt/homebrew/bin`, `/usr/local/bin` and the `PATH`, or at the path in `CITEGEIST_CG`.

## The chat in the sidebar

The chat in citegeist starts Claude Code, Codex or Cursor itself and gives each session its own access token for the MCP server. Nothing needs to be set up, and `cg` is on the `PATH` in the agent's shell (the agent calls `cg concepts list`, for example). You only need the command line tool of the agent installed and logged in (see [getting started](getting-started.md#first-start)).

By default the agent works in your environment: your shell, your MCP servers and your settings. Settings > General > "Isolated agent" removes those. The agent writes requested changes directly into your files, every change carries its origin, and "Undo" takes back a whole turn. See [ADR 0020](decisions/0020-chat-agents-use-the-users-environment.md) and [ADR 0018](decisions/0018-direct-agent-edits-with-undo.md).

## Cloud agents

An agent on the internet reaches your Mac only through a tunnel. Setup has five steps.

**1. Tunnel on port 443.** Cloud agents reach only port 443 (HTTPS). A request to port 8443 timed out with Grok Bot. When another app already serves `/`, forward only the paths `/hooks` and `/mcp`:

```sh
tailscale funnel --bg --https=443 --set-path=/hooks http://127.0.0.1:47321/hooks
tailscale funnel --bg --https=443 --set-path=/mcp http://127.0.0.1:47321/mcp
tailscale funnel status
```

`47321` is the hooks port from Settings > Webhooks. [webhooks.md](webhooks.md#cloudflare-tunnel) describes Cloudflare Tunnel as an alternative.

**2. Public address.** Enter `https://<device>.<tailnet>.ts.net` under Settings > Webhooks > Public address, without port and without path. When the address is missing, citegeist shows a warning in place of the text for the agent.

**3. Connector.** Create a connector in Settings > Webhooks. This example is for the cloud agent of Cursor:

| Field | Value |
|---|---|
| Name | `phd-bot` |
| Kind | Both |
| Address of the agent | `https://api2.cursor.sh/automations/webhook/<routine-id>` |
| Header name | `Authorization` |
| Value | `Bearer crsr_...` (the key of the routine, with `Bearer ` in front) |
| Bearer token | on (for callbacks, starts with `whtok_`) |
| MCP access | Read and write (the token starts with `whmcp_`) |

The auth header and the two tokens are three separate things. The key `crsr_...` belongs to Cursor and travels from citegeist to Cursor. The token `whtok_...` travels from the agent to citegeist when the agent sends a result back. The token `whmcp_...` travels from the agent to citegeist when the agent uses the library tools.

**4. Copy the text for the agent.** Right after you create the connector, citegeist shows the section "Send to your agent" below it, with a finished text. The tokens appear in full, including the whole header value with `Bearer `. Copy the text into the chat of the agent. The same view appears when you turn on MCP access, turn on the bearer token or renew a token. citegeist shows a token only once. Later the connector shows the same text with placeholders such as `<MCP-TOKEN: create a new one in citegeist>`, and a button creates a new token and puts it into the text. The previous token stops working then.

**5. Verify.** "Send test" on the connector triggers the agent. The `curl` commands under [Verify](webhooks.md#verify) show whether the tunnel is open.

### Grok Bot (xAI and Cursor)

Grok Bot cannot store an MCP server from a secret field permanently. Its tool for adding a server needs the header value as plain text in the chat. The text from step 4 is written for that. The MCP part looks like this:

```
Add citegeist as a custom MCP server and save it permanently. Do not search your catalog for it.

Name: citegeist
URL: https://<device>.<tailnet>.ts.net/mcp
Header name: Authorization
Header value: Bearer whmcp_...
```

The words "custom MCP server" matter. Without them Grok Bot searches its catalog and does not find citegeist. For callbacks the agent always uses the address `callback.url` from the respective `task.request`, with the headers `Authorization: Bearer whtok_...` and `x-citegeist-id: <UUID>`. The rest of the text describes the bodies of `task.result`, `papers.add` and `note.add`.

### Troubleshooting

| Observation | Cause and fix |
|---|---|
| Timeout | The agent does not reach the port. The tunnel must run on port 443. Ports 8443 and 10000 do not reach cloud agents. `tailscale funnel status` shows the port. |
| `401` | The token is wrong or old. Create the token again in the "Send to your agent" section and give the agent the new text. `/mcp` needs the MCP token `whmcp_...`, and `/hooks/<name>` needs the bearer token `whtok_...` or the signature. |
| `404` on `/mcp` | No connector has MCP access. Turn it on for the connector. |
| `502` | The tunnel does not reach citegeist. Either citegeist is not running, or no connector exists, in which case the hooks port is not listening. |
| `429` | Too many failed attempts from the same source. Wait a minute. |
| The agent asks for approval on every tool call | The server is not saved permanently. Give the agent the MCP part of the text again, with the token, in the chat, and ask it to save the server permanently. |
