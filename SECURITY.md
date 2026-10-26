# Security policy

## Supported versions

Security fixes go into the latest release. Older releases receive none. If you run an older version, update first (the app offers the update, or run `install.sh` again) and check whether the problem is still there.

## Reporting a vulnerability

Use GitHub Private Vulnerability Reporting on this repository: open the Security tab of [JonnyFi/citegeist](https://github.com/JonnyFi/citegeist/security) and choose "Report a vulnerability". The report is visible only to the maintainers until a fix is published.

Please do not open a public issue or pull request for a vulnerability.

A useful report contains:

- the version of citegeist (Settings, or the release tag) and the macOS version,
- what an attacker needs to be able to do first, and what they gain,
- the steps to reproduce it, or a proof of concept,
- whether the problem needs an agent, a connector, a tunnel or an imported document to be involved.

## What to expect

citegeist is maintained by a small team, so the times below are targets and not guarantees.

- You get a first reply within about a week. It says whether we can reproduce the problem or what we still need from you.
- We keep you informed while we work on it. A fix for a serious problem takes priority over other work and usually ships in the next release. A problem with limited impact may wait for a regular release.
- We agree on a date for the public advisory with you. The advisory names the affected versions and the fixed one, and credits you if you want to be named.
- If we decide that something is not a vulnerability, we tell you why. The reasoning is in [docs/security-model.md](docs/security-model.md) when the behavior is intended.

## Scope

In scope:

- the citegeist app, the core process, the `cg` command and the MCP server,
- the Python workers in `workers/`,
- `install.sh`, the release scripts and the release artifacts on GitHub,
- the webhook and remote MCP endpoints that citegeist opens on your Mac.

Out of scope:

- anything that requires an attacker who already runs code as your macOS user, unless it crosses a boundary that [docs/security-model.md](docs/security-model.md) says holds (a research job reading your files, for example). The section "Known limitations" of that document lists the behaviors that are intended.
- vulnerabilities in the agent CLIs (Claude Code, Codex, Cursor), in AI providers, or in tunnel services such as Tailscale Funnel and Cloudflare Tunnel. Report those to their vendors.
- vulnerabilities in a third-party dependency that citegeist does not reach. Report them upstream. If citegeist is affected, tell us which code path reaches the dependency.
- reports from automated scanners without a demonstrated impact.
- the fixtures in `fixtures/`, which are test data.
