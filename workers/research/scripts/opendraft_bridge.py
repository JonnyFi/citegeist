#!/usr/bin/env python3
"""Hand selected Research Pipeline papers to opendraft as a ready project folder.

Usage:
  python3 opendraft_bridge.py --run RUN_DIR [--key W123 ...] [--dest DIR]

Writes opendraft's own stage-1/2/4 files, so opendraft can start after its source search:
  research/sources.json    raw find --json-shaped records (built from the OpenAlex record,
                           the same way opendraft's sources.py shapes an OpenAlex hit)
  research/sources.md      intro + JSON block in the stage-1 format
  research/summaries.md    stage-2 format, one entry per source with its verbatim abstract
  research/citations.json  built and verified with opendraft's own citations.py (never by hand)
  opendraft-prompt.txt     the prompt to start opendraft at stage 2
"""

import argparse
import datetime
import importlib.util
import json
import os
import re
import subprocess
import sys

SKILL_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(SKILL_DIR, "scripts"))
import settings  # noqa: E402  (data folders; imports nothing of ours)

import papers  # noqa: E402

OPENDRAFT_DIR = settings.OPENDRAFT_DIR
PROJECTS_DIR = settings.PROJECTS_DIR


def opendraft_sources():
    """opendraft's scripts/sources.py, loaded under its own name (Research Pipeline has a sources.py too)."""
    path = os.path.join(OPENDRAFT_DIR, "scripts", "sources.py")
    if not os.path.exists(path):
        raise RuntimeError(f"opendraft not found at {OPENDRAFT_DIR}")
    spec = importlib.util.spec_from_file_location("opendraft_sources", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def find_record(od, work, paper):
    """A record shaped like the OpenAlex branch of opendraft's `sources.py find` (same fields and author split)."""
    source = (work.get("primary_location") or {}).get("source") or {}
    doi = od._norm_doi(paper.get("verified_doi") or work.get("doi"))
    return {"doi": doi, "title": work.get("title") or paper.get("title", ""),
            "authors": od._openalex_authors(work)[:6], "year": work.get("publication_year"),
            # OpenAlex often has no primary source for proceedings; Research Pipeline's venue comes from the raw location names
            "venue": source.get("display_name") or paper.get("venue") or "", "publisher": source.get("host_organization_name", "") or "",
            "type": work.get("type"), "source": "openalex"}


def first_sentences(text, n=3):
    parts = re.split(r"(?<=[.!?])\s+(?=[A-Z])", (text or "").strip())
    return " ".join(parts[:n]).strip() or None


def relevance_from_score(paper):
    try:
        r = float(paper.get("score_relevance") or 0) / 0.3  # points of 30 -> 0..100
    except ValueError:
        return "medium"
    return "high" if r >= 80 else "medium" if r >= 50 else "low"


def unique_dir(base):
    path, n = base, 2
    while os.path.exists(path):
        path, n = f"{base}-{n}", n + 1
    return path


# --- summaries.md in the stage-2 (scribe) format ----------------------------------------------------

def summary_entry(i, rec, paper):
    authors = ", ".join(f"{a['given']} {a['family']}".strip() for a in rec["authors"]) or "Anon."
    head = [f"## Source {i}: {rec['title']} {{cite_{rec['doi']}}}",
            f"**Authors / Year / Venue:** {authors} / {rec['year'] or 'n.d.'} / {rec['venue'] or 'venue not listed'}"]
    abstract = (paper.get("abstract") or "").strip()
    if abstract:
        return head + [
            "**Read:** abstract only",
            "**Extracted by:** abstract below is verbatim from OpenAlex, summarise it at stage 2", "", "### Abstract (verbatim)", f"> {abstract}", "", "---", ""]
    return head + ["**Read:** metadata only", "", f"{rec['title']} ({rec['year'] or 'n.d.'}), no abstract available.",
                   "", "---", ""]


def write_summaries(path, topic, items):
    counts = {"full text": 0, "abstract only": 0, "metadata only": 0}
    body = []
    for i, (rec, paper) in enumerate(items, 1):
        lines = summary_entry(i, rec, paper)
        read = next(l for l in lines if l.startswith("**Read:**"))[len("**Read:** "):]
        counts[read] += 1
        body += lines
    head = ["# Research summaries", "", f"**Topic:** {topic}",
            f"**Sources processed:** {len(items)} ({counts['full text']} full text, "
            f"{counts['abstract only']} abstract only, {counts['metadata only']} metadata only)", ""]
    tail = ["## Cross-source analysis", "", "<!-- to be written at opendraft stage 2 -->", "",
            "### Common themes", "", "### Methodological trends", "", "### Contradictions", "",
            "### Datasets in common use", "", "## Research trajectory", "", "## Must-read (top 5)", "",
            "## Gaps noticed", ""]
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(head + body + tail))
    return counts


# --- sources.md in the stage-1 (scout) format --------------------------------------------------------

def write_sources_md(path, topic, queries, items):
    srcs = []
    for rank, (rec, paper) in enumerate(items, 1):
        abstract = first_sentences(paper.get("abstract"))
        rel = f"Ranked {paper.get('rank') or '?'} by Research Pipeline for this topic ({paper.get('relevance_note') or 'query match'})."
        srcs.append({"rank": rank, "doi": rec["doi"], "title": rec["title"], "authors": rec["authors"],
                     "year": rec["year"], "venue": rec["venue"], "type": rec["type"],
                     "preprint": paper.get("section") == "preprint" or paper.get("is_preprint") == "True",
                     "abstract": abstract, "note": None if abstract else "metadata only, not fetched",
                     "why_relevant": rel,
                     "relevance": relevance_from_score(paper)})
    block = {"search_query": topic, "queries_run": queries, "total_unique_sources": len(srcs), "sources": srcs,
             "gaps_noticed": ["Not assessed here: the pool was selected by hand in Research Pipeline; gaps are identified at stage 3."],
             "suggested_refinements": []}
    intro = (f"Sources for \"{topic}\", selected by hand from a Research Pipeline run (OpenAlex, Semantic Scholar and "
             f"arXiv search, DOIs verified at Crossref/DataCite). Queries run: "
             f"{'; '.join(queries) if queries else 'see the Research Pipeline run'}. {len(srcs)} sources kept. "
             "Abstracts are the first sentences of the OpenAlex abstract.")
    with open(path, "w", encoding="utf-8") as f:
        f.write(f"# Sources\n\n{intro}\n\n```json\n{json.dumps(block, indent=2, ensure_ascii=False)}\n```\n")


# --- prompt ------------------------------------------------------------------------------------------

PROMPT = """Use the opendraft skill to write a paper on "{topic}".

Stage 1 (find sources) is already done. research/sources.json and research/sources.md hold the {n} sources I selected in Research Pipeline. Do not run stage 1 again and do not call scripts/sources.py find. If the pool is below the source floor for the document type, tell me the verified count and continue with this pool instead of searching.

Start at stage 2 (agents/02-scribe.md). research/summaries.md already has one entry per source ({n_abs} with the verbatim OpenAlex abstract, {n_meta} metadata only). Summarise the entries marked "summarise it at stage 2", reading the sources where you need more detail, and write the cross-source analysis, research trajectory, must-read and gaps sections.

At stage 4, research/citations.json is already built with scripts/citations.py build and verified. Re-run `python3 scripts/citations.py verify -d research/citations.json` instead of rebuilding it from new sources.

Then continue with stage 3 and the rest of the pipeline as usual. Ask me your four questions before stage 5.

The paper is delivered in LaTeX. Draft in markdown with {{cite_<doi>}} placeholders exactly as the pipeline prescribes (no raw LaTeX, no hand-written citation markers); the conversion is a script. After the gate has passed (verify, compile to final.md, integrity), run from this folder:

    python3 {latex_script} . --style <the citation style chosen at stage 6> --lang <babel language of the paper, e.g. english or ngerman>

It runs opendraft's own gate again, turns every placeholder into \\autocite with opendraft's BibTeX keys and writes latex/main.tex, latex/references.bib and latex.zip (for Overleaf). Report what it printed, including any warning, and do not edit latex/main.tex by hand."""


def build(run_dir, keys=None, dest=None):
    """Create the opendraft project folder; returns a dict describing what was written."""
    od = opendraft_sources()
    rows, topic = papers.load_papers(run_dir), papers.run_topic(run_dir)
    if not keys:
        raise ValueError("keine Paper ausgewählt")
    items, skipped = [], []
    for key in dict.fromkeys(keys):
        p = rows.get(key)
        if not p:
            skipped.append(f"{key}: not in papers.csv")
            continue
        if p.get("section") == "rejected" or not (p.get("verified_doi") or p.get("doi")):
            skipped.append(f"{p.get('title', key)[:70]}: no verified DOI")
            continue
        work = papers.openalex_work(run_dir, key, p)
        if not work:
            skipped.append(f"{p.get('title', key)[:70]}: no OpenAlex record")
            continue
        rec = find_record(od, work, p)
        if not rec["doi"] or not rec["authors"]:
            skipped.append(f"{rec['title'][:70]}: {'no DOI' if not rec['doi'] else 'no authors in OpenAlex'}")
            continue
        items.append((rec, p))
    if not items:
        raise ValueError("keines der ausgewählten Paper hat eine verifizierte DOI und einen OpenAlex-Eintrag")
    items.sort(key=lambda it: -float(it[1].get("score") or 0))

    meta = papers.read_json(os.path.join(run_dir, "run.json")) or {}
    base = os.path.join(PROJECTS_DIR, f"opendraft-{re.sub(r'[^a-z0-9]+', '-', topic.lower()).strip('-')[:50]}")
    path = unique_dir(os.path.abspath(dest) if dest else base)
    research = os.path.join(path, "research")
    for d in (research, os.path.join(path, "sections"), os.path.join(path, "review")):
        os.makedirs(d, exist_ok=True)

    with open(os.path.join(research, "sources.json"), "w", encoding="utf-8") as f:
        f.write(json.dumps([rec for rec, _ in items], indent=2, ensure_ascii=False) + "\n")
    write_sources_md(os.path.join(research, "sources.md"), topic, meta.get("queries") or [], items)
    counts = write_summaries(os.path.join(research, "summaries.md"), topic, items)

    # citations.json: opendraft's own build + verify, never written by hand
    script = os.path.join(OPENDRAFT_DIR, "scripts", "citations.py")
    steps = []
    for args in (["build", "research/sources.json", "-o", "research/citations.json"],
                 ["verify", "-d", "research/citations.json"]):
        res = subprocess.run([sys.executable, script, *args], cwd=path, capture_output=True, text=True, timeout=600)
        steps.append({"cmd": "python3 scripts/citations.py " + " ".join(args), "returncode": res.returncode,
                      "output": (res.stdout + res.stderr).strip()[-2000:]})
        if res.returncode != 0:
            break

    prompt = PROMPT.format(topic=topic, n=len(items), n_abs=counts["abstract only"],
                           n_meta=counts["metadata only"],
                           latex_script=shell_quote(os.path.join(SKILL_DIR, "scripts", "latex_export.py")))
    with open(os.path.join(path, "opendraft-prompt.txt"), "w", encoding="utf-8") as f:
        f.write(prompt + "\n")
    command = f"cd {shell_quote(path)} && claude \"$(cat opendraft-prompt.txt)\""
    with open(os.path.join(path, "README.md"), "w", encoding="utf-8") as f:
        f.write(f"# opendraft project: {topic}\n\nCreated {datetime.datetime.now():%Y-%m-%d %H:%M} from the Research Pipeline "
                f"run `{os.path.basename(run_dir)}` with {len(items)} sources.\n\nStart opendraft at stage 2:\n\n"
                f"```bash\n{command}\n```\n\nThe prompt is in `opendraft-prompt.txt`. The paper ends up in LaTeX: "
                "`latex/main.tex`, `latex/references.bib` and `latex.zip` for Overleaf.\n")
    return {"path": path, "command": command, "prompt": prompt, "sources": len(items),
            "summaries": counts, "skipped": skipped, "citations": steps,
            "citations_ok": all(s["returncode"] == 0 for s in steps) and len(steps) == 2}


def shell_quote(s):
    return s if re.fullmatch(r"[A-Za-z0-9_./~-]+", s) else "'" + s.replace("'", "'\\''") + "'"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--run", required=True)
    ap.add_argument("--key", action="append", required=True)
    ap.add_argument("--dest", help="project folder (default: <library>/research/opendraft/opendraft-<topic>)")
    args = ap.parse_args()
    out = build(os.path.abspath(args.run), args.key, args.dest)
    for s in out["citations"]:
        print(f"$ {s['cmd']}  (exit {s['returncode']})\n{s['output']}\n", file=sys.stderr)
    for s in out["skipped"]:
        print(f"skipped: {s}", file=sys.stderr)
    print(f"Project: {out['path']}\n{out['sources']} sources, summaries {out['summaries']}\n")
    print(f"Command:\n  {out['command']}\n\nPrompt:\n{out['prompt']}")
    sys.exit(0 if out["citations_ok"] else 1)


if __name__ == "__main__":
    main()
