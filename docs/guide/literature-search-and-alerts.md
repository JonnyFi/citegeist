# Literature search and alerts

## Literature search

"Literature search" in the navigation rail runs a search over OpenAlex, arXiv and Semantic Scholar for a topic. It scores every paper from 0 to 100 and verifies each DOI. The run needs the `uv` environment of the research worker, which uv creates on first use. Runs are stored in the library folder under `research/`.

To start a run:

1. Enter a topic.
2. Write search queries, or choose "Get suggestions" to have the model that you set suggest some. A query searches titles and abstracts. Words in double quotes are a fixed phrase, and every word and phrase must appear.
3. Optionally set the first publication year, the number of peer-reviewed papers in the list (default 40) and additional sources: DBLP (venue and track of computer science papers), OpenReview (review status), Unpaywall (open PDF links) and ORCID (merging split author profiles).
4. Choose "Start search". Only one run goes at a time. A failed, cancelled or interrupted run can be resumed, and it reuses the queries it already fetched.

Without an OpenAlex API key the daily limit is reached quickly. A free key goes into Settings > General > Metadata sources.

A finished run has these sections: peer-reviewed papers, preprints, grey literature and rejected papers. You can filter by year, score and venue tier, sort by any column and open a paper for its score parts (relevance, venue, authors, citations), the reason for its selection and a summary. The charts show papers per year, the distribution by venue tier, the score composition and citations per year.

From a run you can:

- add papers to the inbox or straight to the library,
- download the ranked list (Markdown), all fields (CSV), BibTeX, the summaries or a self-contained HTML report,
- compare two runs and see the new, dropped and re-ranked papers,
- save the search as an alert.

The "Preprints" tab tracks preprints from your runs and from a reference list that you import (a `references.bib` or a Markdown list) and checks them for a peer-reviewed version. A new DOI counts only once it resolves at Crossref or DataCite. The check runs weekly while citegeist is open, and you can start it at any time.

`cg litsearch` exposes the same operations. See [ADR 0022](../decisions/0022-literature-search.md) for how the search fits into citegeist.

## Alerts

An alert is a saved search that runs at an interval while citegeist is open. It adds the best new works to the inbox, with the sender "system" and the reason "Alert: <name>". Alerts exist for the whole library (Settings > Alerts) and for single projects (on the project overview). The sources are:

| Source | Search value |
|---|---|
| arXiv category | For example `cs.CL` or `hep-th` |
| arXiv search | A query, for example `retrieval augmented generation` |
| OpenAlex topic | An OpenAlex topic ID, for example `T10181` |
| OpenAlex search | A query |
| Author | An ORCID or OpenAlex ID |
| Cites a work | The citekey of a library item |
| Pipeline search | A saved literature search, repeated weekly by default |

Each alert has an interval in hours or days, a limit of 1 to 50 works per run and an option to order the results by the brief of the project. Ordering by the brief needs semantic search. "Run now" starts an alert immediately, and "Pause" stops it without deleting it. Works that an alert put into the inbox stay there when you delete the alert.

A pipeline search alert repeats a saved literature search and compares each run with the previous one of the same alert. The works that are new, and that are neither in the library nor in the inbox nor were proposed before, go into the inbox ordered by score.

## Research jobs

The "Research" tab of the agent chat hands a topic to an agent (Claude Code, Codex or Cursor). The agent searches in the background, uses the library through MCP and puts its finds with reasons into the inbox. Research jobs run isolated from your personal agent configuration, have a read-only view of the library apart from `add_item`, and stop at limits you set in the settings. See [settings and models](settings-and-models.md#research-job-limits).
