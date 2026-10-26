# Webhooks for external agents

With webhooks, an external agent such as a Grok bot sends papers and notes to citegeist, and citegeist sends research tasks to the agent. The package is called `@citegeist/webhooks`. The decisions behind it are [agent content goes to the inbox](decisions/0014-agent-content-goes-to-inbox.md) and [general webhooks for any external agent](decisions/0015-webhooks.md). [agents.md](agents.md) explains step by step how to connect an agent. There and under Settings > Webhooks > "Send to your agent" you find the finished text to paste. The threat model for content from the internet is in the [security model](security-model.md).

## Structure

Every agent is a **connector** with a name, for example `grok`. The connector has

- an address on your Mac: `<base URL>/hooks/grok`,
- a secret in the macOS Keychain (account `webhook-grok`, service `citegeist`),
- the actor `agent:grok`. Everything it writes carries this provenance mark,
- optionally an auth header for outbound tasks, a bearer token for inbound requests and MCP access (all three are described below). Their values also live in the Keychain and never in a settings file, and `webhooks.list` never returns them.

There are three kinds: `inbound` (the agent sends to citegeist), `outbound` (citegeist sends tasks to the agent, and the agent answers with a callback) and `both`.

The operations `webhooks.list`, `webhooks.create`, `webhooks.rotateSecret`, `webhooks.setAuth`, `webhooks.setInboundToken`, `webhooks.setMcpAccess`, `webhooks.delete`, `webhooks.test` and `webhooks.send` run through the same core as everything else (RPC and `cg`). Creating, rotating, deleting, testing and all credentials are `admin` operations and therefore closed to agents. The management of webhooks is not reachable over MCP. The MCP access of a connector (see below) gives the agent only the tools of the library.

```
cg webhooks create grok --kind both --url https://grok-bot.example.com/citegeist
```

The response contains the secret exactly once. After that, only the core reads it from the Keychain.

## Signature

Every request in both directions carries three headers:

| Header | Content |
|---|---|
| `x-citegeist-id` | unique id of the delivery, for example a UUID |
| `x-citegeist-timestamp` | Unix time in seconds |
| `x-citegeist-signature` | `v1=` plus the hex of HMAC-SHA256 over `<id>.<timestamp>.<body>` with the secret as key |

The body is JSON and is signed byte for byte as it is sent. The receiver

1. rejects timestamps that deviate by more than five minutes from its clock,
2. compares the signature in constant time,
3. remembers the id and rejects the same id a second time with `409` (replay).

A request with a wrong signature, an unknown connector or an expired timestamp gets `401`. The response does not reveal whether the connector exists. The core answers bodies over 1 MiB with `413`.

After `webhooks.rotateSecret`, the old secret stays valid for `graceMinutes` minutes (default 60) so that the agent can switch over. With `graceMinutes: 0` it is invalid immediately. Several signatures in one header, separated by spaces, are allowed.

### Bearer token instead of signature

Some agents cannot compute an HMAC signature. For them, a bearer token can be switched on per connector (Settings > Webhooks > Bearer token, or `cg webhooks set-inbound-token grok --enabled`, or `--inbound-token` on creation). citegeist shows the token exactly once. Instead of the signature, the agent then sends

```
Authorization: Bearer whtok_...
x-citegeist-id: <unique id>
```

Instead of the `x-citegeist-id` header, the body may carry a field `"id"`. citegeist answers a request without an id with `400` and a reused id with `409`. The core compares the token in constant time. If no token is switched on for the connector, it answers every request with a token like a wrong signature, with `401`. If a request carries a signature header, only the signature counts.

The trade-off: anyone who knows the token can send requests, and there is no timestamp that invalidates an intercepted call after a few minutes. The id only protects against duplicate delivery (the core remembers ids for about eleven minutes and until the next start). The HMAC secret therefore remains the stronger choice, and the token is meant for platforms that cannot do anything else. With `cg webhooks set-inbound-token grok --no-enabled` it is invalid immediately, and a new call with `--enabled` creates a new token.

## Inbound: papers and notes

`POST <base URL>/hooks/<name>` with a JSON body that has a field `event`.

**Add papers** (`papers.add`). Without `target`, the papers land in the inbox ([ADR 0014](decisions/0014-agent-content-goes-to-inbox.md)), with `"target": "library"` directly in the library.

```json
{
  "event": "papers.add",
  "papers": [
    "10.1007/978-3-322-97010-7",
    { "url": "https://arxiv.org/abs/2401.00001", "why": "Discussed in today's X thread" }
  ],
  "why": "Grok search for autopoiesis",
  "target": "inbox",
  "projects": ["systemtheorie"],
  "tags": ["x-thread"]
}
```

A paper is an identifier (DOI, arXiv id, ISBN, PMID, URL) or an object with `identifier` or `url` and its own `why`. Up to 50 per request. The response lists per paper `citekey`, `job` and, where applicable, `duplicateOf` or an error. A failed paper does not stop the others. Local file paths (`/Users/...`, `~/...`, `file://`, `*.pdf` without a DOI prefix) and addresses of this Mac or of private networks (`localhost`, `127.0.0.1`, `192.168.x.x`, `169.254.x.x`, `*.local`) are refused by the receiver with `WEBHOOK_INPUT_REFUSED`, because the sender sits on the internet.

**Add a note or insight** (`note.add`):

```json
{
  "event": "note.add",
  "title": "Luhmann on autopoiesis",
  "text": "In Luhmann, autopoiesis describes the self-production of social systems ...",
  "type": "claim",
  "sources": [
    { "citekey": "luhmann1984soziale" },
    "10.1007/978-3-322-97010-7",
    "https://x.com/someone/status/1",
    { "url": "https://example.org/post", "title": "A blog post" }
  ],
  "projects": ["systemtheorie"]
}
```

The note is created with the actor `agent:<name>`. The sources appear at the end as a section `## Sources`: a citekey becomes a wiki link, an identifier lands in the inbox as a paper and is linked, and a URL becomes a Markdown link. `type` is one of the note types (default `permanent`).

**Ping** (`ping`) answers `200` with `{"ok":true,"pong":true,"connector":"<name>"}` and checks only the signature.

## Outbound: research task

`webhooks.send` sends a task to the URL of an `outbound` or `both` connector:

```json
{
  "event": "task.request",
  "task": "j_01JB8Z3QK7ABCDEFGH",
  "prompt": "Find new sociological work on autopoiesis",
  "project": { "slug": "systemtheorie", "title": "Systemtheorie", "briefExcerpt": "The beginning of the project brief ..." },
  "callback": { "url": "https://mac.example.ts.net/hooks/grok", "event": "task.result" }
}
```

The task is signed as above, with the same secret, and additionally carries the auth header of the connector if one is set. `task` is also the id of the job in citegeist (`jobs.get`). `briefChars` limits the brief excerpt (default 2000 characters, 0 sends none). If the agent does not answer with 2xx, citegeist tries again after 1 and after 5 seconds (three attempts). This applies to network errors, `5xx`, `429` and `400`, because a switched-off routine does not queue the request. For `401`, `403`, `404`, `405` and `410`, repeating does not help, and the attempt stops at once. After that, the job fails with `WEBHOOK_DELIVERY_FAILED`.

### Auth header for the agent's platform

Many platforms check their own key at the trigger and cannot verify `x-citegeist-signature`, for example `Authorization: Bearer <token>` or `x-api-key: <key>`. Such a header can be set per connector. citegeist sends it with every outbound task and every test, in addition to the three signature headers.

```
printf '%s' 'Bearer crsr_...' | cg webhooks create grok --kind both \
  --url https://api2.cursor.sh/automations/webhook/<routine-id> \
  --auth-header Authorization --auth-value-stdin
```

`--auth-value-stdin` reads the value from standard input so that it appears in neither the process list nor the shell history. For an existing connector there is `cg webhooks set-auth grok --auth-header x-api-key --auth-value-stdin`, and `cg webhooks set-auth grok` without a header removes it. In the settings, the value sits in a masked field. The name of the header is stored in `webhooks.json`, the value in the Keychain (account `webhook-grok-auth`). The headers `content-type`, `content-length`, `host`, `connection`, `transfer-encoding`, `user-agent` and all that start with `x-citegeist-` are set by citegeist itself, and their names are blocked.

The agent reports the result with a callback to the same address that applies to inbound requests, and names the `task` id:

```json
{
  "event": "task.result",
  "task": "j_01JB8Z3QK7ABCDEFGH",
  "status": "succeeded",
  "summary": "Three matching papers, one of them an overview.",
  "papers": ["10.1000/p1", "10.1000/p2"]
}
```

The papers land in the inbox of the project, the summary becomes a note, and the job is completed with the result. `"status": "failed"` with `error` makes the job fail. A connector can only answer tasks that it received itself; a second callback for the same id is rejected with `409`. A job waits 24 hours for the callback.

## Reachability from the internet

### The hooks port

The core listens on a random port that changes at every start. A tunnel cannot point at it. That is why citegeist opens a second listener as long as at least one connector exists:

- It binds only `127.0.0.1` and listens on a fixed port, by default **47321**.
- It serves `/hooks/<name>` and, for connectors with MCP access, `/mcp`. Every other path (`/rpc`, `/health`, `/files`, `/events`) results in `404`, even with the token of the core.
- The port of the core stays private. `/hooks/` still answers there for backward compatibility, but the tunnel should point at the hooks port.

You set the port under Settings > Webhooks (or `cg settings update --input '{"patch":{"webhooks":{"port":47400}}}'`). A change takes effect immediately. If the port is taken, citegeist stays stable, Settings > Webhooks shows "Port 47321 is already in use" with the prompt to pick another one, and `webhooks.list` reports `listener: { state: "error", code: "HOOKS_PORT_IN_USE" }`. During this time, the addresses of the connectors point at the port of the core.

### The public address

You enter the address of your tunnel under Settings > Webhooks > Public address (for example `https://mac.tailnet-name.ts.net`). It is stored in the settings and therefore survives a launch from the Dock or Finder, which does not pass on environment variables. The environment variable `CITEGEIST_PUBLIC_URL` overrides the setting when it is set. Everything that builds addresses (`inboundUrl` in `webhooks.list`, the callback address of every task, the MCP address) takes the resolved value. If there is an outbound connector and no public address, the interface shows a hint, because the agent cannot send its result back in that case.

A tunnel works while the Mac is awake and citegeist is running. If a delivery fails in the meantime, the agent sends it again. The replay protection only applies to ids that citegeist has already accepted.

### Tailscale Funnel

Prerequisite: Tailscale is installed and Funnel is enabled in your tailnet (admin console, Access Controls, `funnel` for your device). The commands follow the Tailscale documentation (as of October 2026, <https://tailscale.com/kb/1311/tailscale-funnel>). Check them against the installed version.

```
tailscale funnel --bg --https=443 --set-path=/hooks http://127.0.0.1:47321/hooks
tailscale funnel --bg --https=443 --set-path=/mcp http://127.0.0.1:47321/mcp
tailscale funnel status
```

The first command forwards `/hooks`, the second `/mcp` (only needed if a connector has MCP access). Everything else stays hidden, and another app can keep running on `/` of the same host. The target contains the path so that it is preserved when forwarding; verify this with the commands under [Verify](#verify). Funnel only allows the ports 443, 8443 and 10000 to the outside. Use **443**: agents in the cloud reach only this port, and on 8443 a request from Grok Bot timed out. The local port is free to choose. The address is `https://<device>.<tailnet>.ts.net`. With `--bg`, Funnel keeps running until you turn it off, even after a restart of the Mac. To stop it:

```
tailscale funnel --https=443 --set-path=/hooks off
tailscale funnel --https=443 --set-path=/mcp off
```

### Cloudflare tunnel

Prerequisite: a Cloudflare account with a domain and `cloudflared` (`brew install cloudflared`).

```
cloudflared tunnel login
cloudflared tunnel create citegeist
cloudflared tunnel route dns citegeist hooks.example.com
```

The configuration `~/.cloudflared/config.yml` lets only `/hooks` and `/mcp` through:

```yaml
tunnel: citegeist
credentials-file: /Users/<you>/.cloudflared/<tunnel-id>.json
ingress:
  - hostname: hooks.example.com
    path: ^/(hooks/|mcp$)
    service: http://127.0.0.1:47321
  - service: http_status:404
```

Then run `cloudflared tunnel run citegeist` and enter the address `https://hooks.example.com` as the public address. For a test without a domain, `cloudflared tunnel --url http://127.0.0.1:47321` starts a throwaway tunnel with a random address (for trying things out only).

### Verify

```
cg webhooks test grok
curl -i https://hooks.example.com/hooks/grok       # 405: the route is open, GET is not allowed
curl -i https://hooks.example.com/rpc/items/list   # 404: the rest of the core is unreachable
curl -i -X POST https://hooks.example.com/mcp      # 401 with MCP access, otherwise 404
```

## Connecting a cloud agent

An agent on the internet reaches your Mac only through a tunnel (Tailscale Funnel or Cloudflare tunnel) that points at the hooks port. This applies to everything the agent sends to citegeist on its own: `papers.add`, `note.add`, the result of a task (`task.result`) and access over MCP.

The direction from the Mac to the agent needs no tunnel. An outbound `task.request` needs only the public trigger address of the agent and its auth header. For the agent to answer, however, the callback address in the task (`task.result`) must be reachable, and it is only reachable through the tunnel and the entered public address.

| What | Needs a tunnel? |
|---|---|
| Send `task.request` to the agent | no, the trigger address and auth header of the agent are enough |
| `task.result` from the agent back to citegeist | yes |
| `papers.add` and `note.add` from the agent | yes |
| MCP access of the agent to the library | yes |

The steps:

1. Create a connector (Settings > Webhooks or `cg webhooks create`).
2. Set up the tunnel to `127.0.0.1:47321` (see above) and enter its address as the public address.
3. Give the agent what it needs for its direction: the secret or the bearer token for requests to `/hooks/<name>`, the MCP token for `/mcp`.
4. Verify with "Send test" and the `curl` commands above.

The text for the agent with addresses, headers and token is generated under Settings > Webhooks > "Send to your agent". [agents.md](agents.md) describes the whole flow, including troubleshooting.

## MCP for cloud agents

A cloud agent cannot reach a local MCP server on your Mac. If it supports remote MCP servers over HTTP, it can use the same tools as a local agent: the hooks port serves `/mcp` with Streamable HTTP and the tool set of `cg mcp`. The design is described in [remote MCP through a tunnel](decisions/0023-remote-mcp-through-a-tunnel.md).

- **Opt-in per connector.** Settings > Webhooks > MCP access (or `cg webhooks set-mcp-access grok --enabled`, `--scope read` for read-only tools, or `--mcp write` on creation). citegeist generates a token (`whmcp_...`), shows it once and stores it in the Keychain (account `webhook-grok-mcp`).
- **Authentication.** `Authorization: Bearer <token>`, compared in constant time. The webhook secret and the inbound bearer token are not MCP tokens.
- **Actor.** All writes run as `agent:<connector>`, whatever the client calls itself. New papers land in the inbox ([ADR 0014](decisions/0014-agent-content-goes-to-inbox.md)), exactly as with a local MCP agent.
- **Permissions.** As with local MCP agents: read and write, never `admin`. Settings, webhooks and deletions beyond `trash_item` are unreachable. An agent on the internet also may not read files of this Mac: the core refuses `add_item` with a local path and `attach_file`. The [security model](security-model.md) covers how text from such agents is treated.
- **No access, no endpoint.** If no connector has MCP access, `/mcp` answers `404`. With access, a wrong token is followed by `401`. After ten failed attempts within a minute from the same source (behind a tunnel, the forwarded address, `x-forwarded-for`), the listener answers `429` with `retry-after`; in total, 100 failed attempts per minute are allowed.
- **Revoking.** `cg webhooks set-mcp-access grok --no-enabled` invalidates the token immediately; deleting the connector does the same.

### Sessions and restarts

Clients that speak the 2025 protocol get a session (`Mcp-Session-Id`) on `initialize`. The core keeps sessions in memory only and loses them on every restart, for example after an app update. No tool depends on a session, so `/mcp` also accepts an unknown session id: the core opens a new session for the same connector and returns it in the `Mcp-Session-Id` header of the response. The protocol expects `404` here, and some clients (Grok Bot) do not recover from it. Further rules:

- The core closes a session that nobody used for 24 hours. The next call with its id opens a new one.
- Open SSE streams (`GET /mcp`) get a comment (`: keepalive`) every 15 seconds, so Funnel or Cloudflare do not drop a quiet stream.
- A restart of the core interrupts calls in flight. This includes the seconds in which the tunnel answers `502` because the hooks port is not listening yet.

For troubleshooting, the core writes lines prefixed with `mcp:` to its log: `session ... opened`, `unknown session ... replaced by ...` (a session from before a restart was replaced), `closed ... idle`, and the source of the request on `401` or `429`. Tokens and full session ids never appear. The app writes these lines, together with its own, to `~/Library/Logs/citegeist/core.log`. The file rotates at 5 MB and keeps three files (`core.log`, `core.log.1`, `core.log.2`). Secrets such as tokens and API keys are removed before a line is written. Open the file from the About window (citegeist menu, "About citegeist") or from Settings under "Troubleshooting" with "Open log".

## Grok Bot (xAI and Cursor)

Grok Bot runs in the cloud on its own machine (browser, file system, terminal). It cannot reach local MCP servers but supports remote MCP servers over HTTP. Routines have a webhook trigger: `POST https://api2.cursor.sh/automations/webhook/<routine-id>` with `Authorization: Bearer crsr_...`. The body becomes the input of the run. The call answers immediately with `200 {"success":true,"runUuid":"..."}`, with `400` for a switched-off routine (the request is then not queued) and with `401` for a wrong key.

**1. Tunnel.** Create a connector and set up Tailscale Funnel to the hooks port:

```
tailscale funnel --bg --https=443 --set-path=/hooks http://127.0.0.1:47321/hooks
tailscale funnel --bg --https=443 --set-path=/mcp http://127.0.0.1:47321/mcp
```

Enter `https://<device>.<tailnet>.ts.net` (without a port) under Settings > Webhooks > Public address.

**2. MCP.** Switch on MCP access for the connector. Under "Send to your agent", citegeist then shows a text that you paste into the Grok Bot chat. Grok Bot cannot store an MCP server from a secret field: its tool needs the header value (`Bearer whmcp_...`) as plain text in the chat, and the words "custom MCP server" in the text prevent a search of the catalog. After that, Grok uses `search`, `add_item`, `create_card` and the other tools and writes as `agent:grok`. The details are in [agents.md](agents.md#grok-bot-xai-and-cursor).

**3. Tasks.** Create a routine with a webhook trigger in Grok Bot. Enter its address as the target of the connector and `Authorization` with `Bearer crsr_...` as the auth header (kind "both"). With `webhooks.send` or the test in the settings, citegeist triggers the routine. The result comes back by one of two routes: the routine calls MCP tools, or it sends `task.result` to the callback address from the task, signed with the secret of the connector (or with the bearer token, if switched on).

A switched-off routine answers the call with `400`. citegeist tries three times, after which the job fails with `WEBHOOK_DELIVERY_FAILED` and names the status.

## Example client for Grok Bot

With curl (OpenSSL and `uuidgen` are available on the Mac). The body is sent with `--data-binary` so that the bytes are exactly the ones that were signed:

```bash
SECRET='whsec_...'                    # from webhooks.create
URL='https://hooks.example.com/hooks/grok'
BODY='{"event":"papers.add","papers":["10.1007/978-3-322-97010-7"],"why":"Grok find from the X thread"}'

ID=$(uuidgen)
TS=$(date +%s)
SIG=$(printf '%s.%s.%s' "$ID" "$TS" "$BODY" | openssl dgst -sha256 -hmac "$SECRET" -hex | sed 's/^.* //')

curl -sS -X POST "$URL" \
  -H 'content-type: application/json' \
  -H "x-citegeist-id: $ID" \
  -H "x-citegeist-timestamp: $TS" \
  -H "x-citegeist-signature: v1=$SIG" \
  --data-binary "$BODY"
```

With Node (version 18 or later, no packages):

```js
import { createHmac, randomUUID } from "node:crypto";

const SECRET = process.env.CITEGEIST_WEBHOOK_SECRET;
const URL = process.env.CITEGEIST_WEBHOOK_URL; // https://hooks.example.com/hooks/grok

export async function send(payload) {
  const body = JSON.stringify(payload);
  const id = randomUUID();
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", SECRET).update(`${id}.${timestamp}.${body}`).digest("hex");
  const res = await fetch(URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-citegeist-id": id,
      "x-citegeist-timestamp": timestamp,
      "x-citegeist-signature": `v1=${signature}`,
    },
    body,
  });
  return { status: res.status, body: await res.json() };
}

console.log(await send({ event: "papers.add", papers: ["10.1007/978-3-322-97010-7"], why: "Grok find" }));
```

To verify a task from citegeist, the bot computes the same signature over `<x-citegeist-id>.<x-citegeist-timestamp>.<raw body>` and compares it with the header before it executes anything. It reads the raw body before any JSON parsing.

## Integration in the core

`packages/webhooks` exports `attachWebhooks(host, options)`. `startCoreServer` in `packages/server` calls it before the RPC router is built, so that `webhooks.*` is part of the router:

1. `dir` is the machine-local folder of the library, `secrets` the Keychain (`MacKeychain`, in-memory on other systems), `port` supplies the bound port, and `publicBaseUrl` comes from `CITEGEIST_PUBLIC_URL`, otherwise from the setting `webhooks.publicUrl`.
2. The request listener asks `hooks.handle(req, res)` first. Paths under `/hooks/` are answered by the webhook service according to the signature, and all other paths continue through the checks for host, origin and token.
3. Tasks for external agents are jobs of kind `research`. The research jobs of the chat (`research.start`) use the same kind. The queue holds one handler per kind, so both users share the kind through `shareKind` from `@citegeist/core`: each gets its own port with its own handler and its own concurrency limit. Jobs of the webhook service carry `webhook` in their input, and all others belong to the chat. The job list of the app shows both as research.
4. The hooks port belongs to `manageHooksListener` (`packages/server/src/core/hooks-listener.ts`). It starts, moves or stops the listener on every change of the settings and on every creation or deletion of a connector. The listener hands `/hooks/` to `attachWebhooks` and `/mcp` to `createMcpRequestHandler` from `@citegeist/mcp`, the same implementation as `cg mcp --http`, with the actor of the connector and without access to local files.

With `startCoreServer({ webhooks: false })`, receiver and operations are omitted. `webhooks: { secrets, publicBaseUrl, fetch, hooksPort, retryDelaysMs }` replaces the Keychain, address, HTTP client, hooks port (0 picks a free one) and the waiting times between delivery attempts (tests).
