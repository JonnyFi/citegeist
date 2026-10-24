"""Papers of a run: keys, papers.csv, run.json and cached OpenAlex records.

Taken from research-pipeline's matrix.py, without the matrix itself: citegeist has its own
literature matrix, so the run folder only keeps what the alerts and the opendraft handover need.
"""

import csv
import hashlib
import json
import os
import re

import net
import sources

WORK_SELECT = ",".join(["id", "doi", "title", "publication_year", "type", "authorships",
                        "primary_location", "best_oa_location", "open_access", "locations"])


def read_json(path, default=None):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return default


def write_json(path, data):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    os.replace(tmp, path)


def paper_key(p):
    """Stable, filename-safe id: the OpenAlex id, else a hash of DOI or title."""
    oid = (p.get("openalex_id") or "").strip()
    if re.fullmatch(r"W\d+", oid):
        return oid
    basis = (p.get("verified_doi") or p.get("doi") or p.get("title") or "").lower()
    return "p" + hashlib.sha1(basis.encode()).hexdigest()[:12]


def load_papers(run_dir):
    """All papers of a run, keyed by paper_key, in papers.csv order."""
    with open(os.path.join(run_dir, "papers.csv"), encoding="utf-8-sig", newline="") as f:
        rows = list(csv.DictReader(f))
    out = {}
    for row in rows:
        out.setdefault(paper_key(row), row)
    return out


def run_topic(run_dir):
    meta = read_json(os.path.join(run_dir, "run.json")) or {}
    if meta.get("topic"):
        return meta["topic"]
    try:
        with open(os.path.join(run_dir, "papers.md"), encoding="utf-8") as f:
            m = re.match(r"#\s*(?:lit-scout|Research Pipeline):\s*(.+)", f.readline())
            if m:
                return m.group(1).strip()
    except OSError:
        pass
    return os.path.basename(run_dir)


def openalex_work(run_dir, key, paper):
    """The OpenAlex record with open-access locations, cached in <run>/works/."""
    path = os.path.join(run_dir, "works", f"{key}.json")
    work = read_json(path)
    if work:
        return work
    oid = (paper.get("openalex_id") or "").strip()
    doi = sources.bare_doi(paper.get("verified_doi") or paper.get("doi"))
    ident = oid if re.fullmatch(r"W\d+", oid) else f"doi:{doi}" if doi else None
    if not ident:
        return None
    try:
        work = net.fetch(f"{sources.OPENALEX}/works/{ident}", sources._oa({"select": WORK_SELECT}))
    except net.NotFound:
        return None
    os.makedirs(os.path.dirname(path), exist_ok=True)
    write_json(path, work)
    return work
