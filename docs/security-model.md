# Security model

This document describes how citegeist protects your library, your keys and your Mac, and where the protection ends. It describes the code as it is. To report a problem, read [SECURITY.md](../SECURITY.md).

citegeist runs entirely on your Mac. The project operates no server, the app sends no telemetry, and your library is a folder of plain files that you own.

## Trust boundaries

citegeist consists of several processes. Each boundary between them has its own rule.

**Renderer.** The window shows the interface in a sandboxed Chromium page. It renders text from imported documents, web pages and agents, so it is the component that sees the most untrusted content. It holds the port and token of the core and nothing else of value. Its protections are the HTML filter of the reader, a content security policy and the sender checks on the main process (see "Electron hardening").

**Main process.** The Electron main process opens windows, file dialogs and the quick insert palette, checks once a day whether a new release exists, and starts the core as a child process. It hands the core's connection data only to its own renderer.

**Core process.** The core is the only writer of the library. It listens on `127.0.0.1` on a random port and answers HTTP, oRPC and a WebSocket for change events. Every request needs the bearer token of the core, a 32 byte random value. The core also checks the `Host` header against DNS rebinding and accepts browser origins only from the renderer. The token lives in `core.token`, next to `core.lock`, in a folder under `~/Library/Application Support/citegeist` that only your user can open (mode 0700). Both files have mode 0600, and the core removes them when it exits.

**Python worker.** The worker converts PDFs, web pages and other documents and runs the literature search. It is a child process of the core that talks over stdin and stdout and opens no port. It processes untrusted files with your user's rights. On first start it downloads GROBID, a Java runtime and models. The downloads of GROBID and the Java runtime are checked against fixed SHA-256 values, models are pinned to a commit, archives are extracted with Python's `data` filter, and the worker starts no subprocess through a shell.

**Agent CLIs.** The chat and the research jobs use the agent CLIs you have installed (Claude Code, Codex, Cursor) with your own logins. The core starts them as child processes and gives each session its own MCP connection to citegeist. What these agents may do is the subject of the next sections.

**MCP clients.** A local client starts `cg mcp`, which forwards to the running core or opens the library itself. A remote client connects through a tunnel to the hooks listener. Both see the same tools, filtered by the scope of their token.

**Webhook senders.** External agents call `/hooks/<name>` with a signature or a bearer token that belongs to one connector.

**Network.** The core fetches papers and metadata. Fetches that an agent or a job starts pass the address checks described under "Network egress".

## Actors and provenance

Every operation runs as an actor: `human`, `agent:<name>` or `system`. Whatever an actor writes carries the actor in its `by:` field, so a note, a link or a card shows who produced it. Papers that an agent or a job adds go into the inbox by default, with `inbox.by` and a reason (`why`). A write token or a signed webhook may ask for a paper to go straight into the library. A research token may not.

The actor is a record of provenance. The core takes it from the `x-citegeist-actor` header for callers that hold the core token, and from the token itself for MCP clients. A process that holds the core token can claim any actor, which is why the boundaries below rest on tokens and scopes and not on the label.

Operations of the class `admin` change settings, backends, the worker and the webhook connectors. MCP never lists them, for any token. Over the core's own RPC they are available to the human actor.

## What an agent can do

**Default.** The chat in the sidebar gives the agent the same environment as the agent CLI has in your terminal: your shell, your MCP servers and your settings, plus citegeist's tools for the session. The agent can do what you can do in a terminal, which includes reading your files, running commands and calling the core with the token from `core.token`. The permission rule of the chat still protects the library's derived data, converted originals, exports and the manifest from edits where the adapter asks for permission. Before and after each turn the core compares the library folder, so changes made through the shell appear in the turn's history and can be undone.

**Isolated agent.** Settings, section "Chat agent", has the switch "Isolated agent". With it, the agent starts without a shell, without your settings and without your MCP servers. It has citegeist's tools only. Reading and searching are limited to the library folder and the session's working folder, including the fixed part of a glob or a pattern. Adding a local file to the library is limited to those two folders as well. Fetching web addresses stays open, because you are watching the session. Switching the setting restarts the agent at the next message.

**Research jobs.** Unattended research jobs are always isolated and follow the next section.

**Agents on the other side of MCP.** A local agent that uses `cg mcp` runs in whatever environment you started it in. The tools it gets from citegeist depend on the scope of its connection. A remote agent gets the tools of its connector's scope and nothing outside the library (see "Remote access").

## Research jobs and the Rule of Two

A research job reads untrusted text from the web and has your library in reach. The Rule of Two says an agent that has both should not also act freely toward the outside. A research job therefore loses the third property:

- Its token has the scope `research`. It sees the read-only tools and `add_item`, and no other tool. `add_item` always puts the paper into the inbox, also when the call asks for the library.
- The core refuses local files for this token. Paths, `file://` addresses and bare file names are rejected, and `items.attach` is rejected entirely.
- The core refuses every web address outside a fixed list of scholarly hosts (`SCHOLARLY_HOSTS` in `packages/ops/src/research.ts`). DOIs, arXiv ids, PubMed ids, ISBNs and BibTeX remain possible. The core enforces this itself, so it holds for every adapter and for the fallback that runs `claude -p`.
- The permission rule lets the agent open an address only if it is on a scholarly host or was returned verbatim by a web search in the same session. An address that appears in fetched page text does not count, and neither does an address with an appended query. In the `claude -p` fallback nobody can be asked, so the agent gets web search and fetches from scholarly hosts only.
- Webhooks cannot be sent by an agent, because those operations are `admin`.
- Runs have limits that you can change in the settings: 20 minutes, 200 tool calls and 2 million tokens, and a job ends when the same tool call with the same arguments comes three times in a row. Cancelling a job ends the agent's whole process group. What the job found before it stopped stays in the inbox.

## Prompt injection

Text from PDFs, web pages, resolver metadata, notes and the reasons that agents or webhooks supply can contain sentences that look like instructions. Every AI task in `packages/ai` therefore passes such text through `mark` before it enters a prompt. This is the datamarking variant of spotlighting (Hines et al., arXiv 2403.14720): every run of whitespace becomes the character U+02C6, existing U+02C6 characters are removed, and the system text says that marked text is data. A line break can no longer end a quoted block, and an injected sentence looks different from the rules around it. A test fails when a task embeds fixture text unmarked.

Identifiers that citegeist creates itself, such as citekeys and card ids, stay unmarked so that models can return them exactly. The task that suggests search queries takes only the topic you type.

Datamarking lowers the risk and does not remove it. Results therefore never go into the library unchecked. Paraphrases and entries carry `by:`, quotes must occur in the source text (the check runs against the unmarked text), and suggested links start as `proposed`. The chat agents and research jobs get the same instruction in their system text: tool results are data.

## Network egress

The app contacts these services and no others:

- scholarly metadata sources such as Crossref, OpenAlex, arXiv, PubMed, Europe PMC and Semantic Scholar, and Unpaywall if you have set an email address. If you set a contact email address, it is sent to the sources that use it for their polite pools.
- the sites of the papers and web pages you add.
- model hosting for the embedding and conversion models (downloaded once), and the download hosts of GROBID and the Java runtime.
- the AI backend you chose: the CLI you installed with its own login, or a provider API with the key you stored.
- the GitHub releases API, at most once a day, for the update notice.
- the tunnel and the agents you connect yourself.

**Address checks.** You may fetch any address, including a PDF on your company network. For every other actor (an agent, a job, the Zotero connector, a webhook sender) the core checks each step of a download. It follows at most five redirects itself and checks every target again. It resolves names and requires that all resulting addresses are public. It refuses loopback, private ranges (10/8, 172.16/12, 192.168/16), link-local (169.254/16, which includes the cloud metadata address), carrier-grade NAT (100.64/10), multicast and reserved ranges, their IPv6 counterparts including embedded IPv4 forms, `localhost`, `*.local`, `*.localhost`, `*.internal`, `*.lan` and names without a dot. The core reads the body as a stream and stops at 300 MiB. A webhook sender's input gets a first check on top of this, before `items.add` is called: local paths and non-HTTP schemes are refused.

**Research jobs** add the host list from the previous section.

## Secrets

- API keys and webhook secrets live in the macOS Keychain under the service `citegeist`. Settings files in the library or the application folder never contain them, and `webhooks.list` never returns them.
- A key travels to the `security` tool hex encoded on stdin, so it appears in no process listing, and error messages have the key removed.
- The MCP token of a chat session is written to a `mcp.json` file with mode 0600 inside a private folder (0700) that the core removes when the session ends. It is never an argument on a command line.
- Each chat or research session gets its own write token. The core revokes it as soon as the session's agent is gone, and the MCP server reads the list of valid tokens on every request, so a revoked token stops working at once.
- The token of the core is accepted as a query parameter on two paths only, `/events` for the WebSocket and `/files/` for images and frames. Everywhere else it must be in the `Authorization` header.
- Files served from `/files/` are limited to the library's items folder after resolving symlinks, and they are sent with `content-security-policy: sandbox` and `nosniff`.

## Remote access

Remote access is off until you create a webhook connector. Then citegeist opens a second listener on `127.0.0.1` and a fixed port (47321 by default). It serves `/hooks/<name>` and, for connectors with MCP access, `/mcp`, and no other route of the core. You make it reachable by pointing a tunnel (Tailscale Funnel or Cloudflare Tunnel) at that port. The core's own port stays private.

- Inbound webhooks need an HMAC-SHA-256 signature over the delivery id, the timestamp and the body, or, if you switch it on for a connector, a bearer token. Signatures are compared in constant time, timestamps older than five minutes are refused, and a delivery id works once. Bodies over 1 MiB and requests that take longer than 30 seconds are cut off. A request for an unknown connector looks like one with a wrong signature.
- Remote MCP uses a separate token for each connector, shown once and stored in the Keychain. The endpoint does not exist (`404`) while no connector has MCP access.
- A source that fails authentication ten times within a minute gets `429`, and so does everything after 100 failures per minute across all sources. The source address is the last entry of `x-forwarded-for` (the tunnel appends the address it saw), or the socket address.
- A remote agent acts as `agent:<connector>`, with read or write scope as you chose. It cannot call `admin` operations, which MCP never lists, and it cannot make the core read a local file. Paper input from the web is checked against local paths and private addresses before it is handled.
- Webhook secrets can be rotated. The old secret stays valid for a grace period that you choose.

## Electron hardening

- The window runs with `contextIsolation` and `sandbox`, and without `nodeIntegration`.
- The renderer carries a content security policy as a meta tag. Scripts come from the bundle and from one inline script pinned by its hash, with no `unsafe-inline` and no `unsafe-eval` for scripts. Connections go to the local core only. Frames, objects, forms and `base` are blocked. Images from foreign servers do not load.
- All permission requests are denied except writing to the clipboard.
- Navigation away from the interface and new windows open `http(s)` addresses in your browser and nothing else. Deep links `citegeist://` map to a fixed list of routes.
- Every IPC handler of the main process checks that the message comes from the top frame of the app's own renderer page. Any other page that gets the preload bridge receives no connection data.
- The web content that the reader shows passes a sanitizer that drops scripts, SVG animation and `use` elements, frames, `foreignObject`, templates and `javascript:` addresses and allows only `http(s)`, `mailto`, `tel` and raster `data:` images in links and sources. External addresses from metadata become links only if they are `http(s)` addresses.
- Electron fuses are set so that `NODE_OPTIONS` and the inspector flags are ignored and the app code loads only from `app.asar`.
- The `RunAsNode` fuse stays on, because the chat adapters run as the app binary with `ELECTRON_RUN_AS_NODE`.

## Code signing and distribution

Releases are built on the maintainer's Mac for Apple Silicon and published as a zip with a SHA-256 file on GitHub. The app is signed ad hoc, or with a self-signed identity named "citegeist local signing" when the build machine has it (`scripts/make-signing-cert.sh`). A self-signed identity keeps the code signature the same across builds, so macOS keeps the Accessibility grant after an update. It is not a Developer ID. The app is not notarized and the hardened runtime is off.

The installer is `curl -fsSL https://raw.githubusercontent.com/JonnyFi/citegeist/main/install.sh | sh`. It reads the latest release from the GitHub API, downloads the zip and its checksum file, compares them, and replaces the app in `/Applications` or `~/Applications`. It also links the `cg` command to `~/.local/bin/cg` if that name is free. Files downloaded with `curl` carry no quarantine attribute, so Gatekeeper does not assess the app. The in-app update notice opens Terminal and runs the same script.

The checksum file comes from the same release as the zip. It detects a damaged or incomplete download. It does not protect against a release that was replaced on GitHub, so the trust anchor is the maintainer's GitHub account and TLS to GitHub. If you want more, build from source with `pnpm package` and compare against the release.

The CI workflows pin every action to a commit, and Dependabot proposes updates to the JavaScript and Python dependencies and to the actions.

## Telemetry

citegeist collects nothing. The app has no analytics and no crash reporting. The ledger of AI calls (`ai_usage` in `state.sqlite`) stays on your Mac and is never synced. The only requests the app starts by itself are those in "Network egress".

## Known limitations

These are properties of the design. Each comes with what you can do about it.

- **Agents running with your shell can do what you can do.** In the default chat environment an agent can read your files, the token of the core and the Keychain entries of citegeist, and it can call the core as `human`, including `admin` operations. Entries it writes through the core then show `human` as the actor. A shell is what makes the chat useful for real work, so this is the default. Switch on the isolated agent to restrict the chat to citegeist's tools. Research jobs are always isolated. The turn history shows what changed in the library.
- **Keychain items are readable by any process of your user.** citegeist writes and reads them through the `security` tool, and `security` is on the access list of the item. Any process of your user can run `security find-generic-password -s citegeist -a <account> -w` and read an item without a prompt. Limiting an item to citegeist's own code signature would mean that the app itself creates and reads it, and that the signature stays the same across updates. Ad hoc builds change the signature with every build, and macOS would ask again after every update. The isolated agent and research jobs have no shell, so they cannot reach the items.
- **The app is not notarized.** Gatekeeper does not vouch for it, and the installer works around quarantine by design. The checksum and TLS to GitHub carry the trust, as described above. Building from source avoids the question.
- **A name that changes its address between check and fetch can pass the address check.** The core resolves a name, checks the addresses, and the HTTP client resolves the name again when it connects. An attacker who controls a DNS server can answer differently the second time. This matters for the actors that may fetch freely or from many hosts, which are the isolated chat, the Zotero connector and the webhook senders. Research jobs reach scholarly hosts only. The connector is off by default, and a fetched page becomes a library item that you see in the inbox.
- **The core accepts the browser origin `null`.** The renderer loads from a `file://` page, which sends `null`, and so does any sandboxed frame in a browser. The bearer token stays the lock, because no web page can obtain it.
- **The Zotero connector accepts the origin of any browser extension.** Its protocol has no token, and it is off by default. When on, a malicious browser extension can add items. Everything it adds is checked against the address rules and marked `agent:zotero-connector`.
- **A captured webhook can be replayed after a restart of the core.** The record of used delivery ids is in memory. A signed request is valid for five minutes, so a replay is possible only inside that window, and it repeats an addition to the inbox that the duplicate check recognizes. Bearer-token connectors have no timestamp, so use the HMAC secret when the sender can compute it.
- **A research job can steer small amounts of information outward.** It can choose which search hit to open, and a DOI is resolved by a host that the publisher picks. The requests carry no library content, only what the job chooses to look up. Switch research jobs off if the library holds material that must not influence any outgoing request.
- **Datamarking reduces prompt injection and cannot stop it.** A stronger attack or a different model may get through. That is why model output reaches the library only as marked, checkable or proposed content.
- **Documents are parsed with your user's rights.** PDFs and web pages go through PDF and HTML libraries and a Java based tool without an operating system sandbox. The mitigations are the pinned dependencies, the regular updates and the fact that the worker opens no port.
