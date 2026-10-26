# ADR 0022: Literature search

Status: accepted. Date: 2026-10-24.

## Context

A separate research pipeline searched sources, scored papers and tracked preprints. It had its own web server, web interface and background jobs.

## Decision

- The pipeline scripts live in `workers/research` (Python standard library only) and run with uv in their own environment. The web server and web interface of the pipeline are left out. The core starts `workers/research/scripts/pipeline.py` as a job for each run, and the UI shows a "Literature search" tab over the `litsearch.*` operations.
- Where citegeist already has a function, the citegeist version applies. Results go to the inbox like citation graph candidates ([ADR 0014](0014-agent-content-goes-to-inbox.md)), and the literature matrix and retraction warnings are the ones of citegeist. The OpenAlex key lives in the keychain under `openalex`.
- A search that should repeat is an alert of kind `pipeline` (pipeline search). Each check starts a `litsearch.run` job and compares it with the previous run of the alert. New papers that are in neither the library nor the inbox are sent to the inbox by score, with the sender "system" and the reason "Alert: <name>".
- The default interval is one week, because a run is expensive, and only one search runs at a time. The alert timer drives the schedule while the app is open.
- Watchlists of older libraries (`research/watches/watchlists.json`) are converted to alerts once at startup, and the file is renamed to `watchlists.json.migrated`. Preprint versions are detected by `graph/versions.ts`. `research/watches/preprint-checks.json` holds the result for preprints without a graph entry.

## Consequences

Searches share inbox, matrix and alert list with the rest of the app. Search suggestions run through the configured model.
