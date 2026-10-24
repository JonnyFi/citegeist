#!/usr/bin/env python3
"""The list of preprints the citegeist literature search tracks, and their OpenReview status.

Usage:
  python3 preprints.py sync                    # collect the preprints of all runs
  python3 preprints.py import FILE [FILE ...]  # a references.bib or a Markdown reference list
  python3 preprints.py openreview [--all]      # OpenReview status of due preprints (weekly with every watchlist run)
  python3 preprints.py list [--json]           # --json: syncs the runs first, for the app

This script keeps only what the core cannot know: which preprints the runs and the imported
reference lists mention, and where an OpenReview decision stands. Whether a preprint has a
published version is decided by the core (packages/core, graph/versions.ts), which stores the
relation in the library graph or, for papers outside the library, in its own check cache.
"""

import argparse
import contextlib
import csv
import datetime
import fcntl
import json
import os
import re
import sys

SKILL_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(SKILL_DIR, "scripts"))
import settings  # noqa: E402  (data folders; imports nothing of ours)

import extra_sources  # noqa: E402
import miniyaml  # noqa: E402

RUNS_DIR = settings.RUNS_DIR
WATCH_DIR = settings.WATCH_DIR
STORE = os.path.join(WATCH_DIR, "preprints.json")
RECHECK_DAYS = 6  # a weekly run looks every preprint up at OpenReview once
PREPRINT_DOI_PREFIXES = ("10.48550/", "10.2139/", "10.21203/", "10.1101/", "10.20944/", "10.36227/",
                         "10.22541/", "10.31219/", "10.31234/", "10.31235/", "10.5281/", "10.6084/", "10.17605/")
PREPRINT_VENUES = re.compile(r"arxiv|ssrn|preprint|research square|biorxiv|medrxiv|techrxiv|authorea|"
                             r"chemrxiv|openreview|zenodo|osf|figshare|social science research network", re.I)
DOI_RE = re.compile(r"10\.\d{4,9}/[^\s\"'<>{}]+", re.I)
ARXIV_RE = re.compile(r"(?:arxiv\.org/(?:abs|pdf)/|arxiv[:\s]+|10\.48550/arxiv\.)(\d{4}\.\d{4,5}|[a-z\-]+(?:\.[A-Z]{2})?/\d{7})", re.I)


def now():
    return datetime.datetime.now().isoformat(timespec="seconds")


def read_json(path, default=None):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return default


def write_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = f"{path}.{os.getpid()}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    os.replace(tmp, path)


@contextlib.contextmanager
def locked():
    """Exclusive lock for read-modify-write of the store (the lock file is watch.py's, never held in a nest)."""
    os.makedirs(WATCH_DIR, exist_ok=True)
    with open(os.path.join(WATCH_DIR, ".lock"), "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        yield


def save(store, before):
    """Write the store only if it differs from what was loaded (`before` is its JSON text)."""
    if dump(store) != before:
        write_json(STORE, store)


def load():
    return read_json(STORE, {"items": {}, "imports": []})


def dump(store):
    return json.dumps(store, sort_keys=True)


def bare_doi(doi):
    return re.sub(r"^(?:https?://(?:dx\.)?doi\.org/|doi:)", "", (doi or "").strip(), flags=re.I).lower()


def is_preprint_doi(doi):
    return bare_doi(doi).startswith(PREPRINT_DOI_PREFIXES)


def clean_doi(doi):
    return bare_doi(doi).rstrip(".,;)]}")


def item_id(doi, arxiv):
    return f"arxiv:{arxiv.lower()}" if arxiv else f"doi:{clean_doi(doi)}"


def add(store, *, title, doi="", arxiv="", openalex_id="", year=None, authors=(), origin):
    """Add or merge one preprint; returns True if it is new to the store."""
    doi = clean_doi(doi)
    if not arxiv:
        m = re.match(r"10\.48550/arxiv\.(.+)$", doi)
        arxiv = m.group(1) if m else ""
    if not arxiv and not doi:
        return False
    iid = item_id(doi, arxiv)
    item = store["items"].get(iid)
    new = item is None
    if new:
        item = store["items"][iid] = {"id": iid, "title": title or "", "doi": doi or (f"10.48550/arxiv.{arxiv}" if arxiv else ""),
                                      "arxiv_id": arxiv, "openalex_id": openalex_id, "year": year,
                                      "authors": list(authors)[:5], "origins": [], "first_seen": now()}
    for k, v in (("title", title), ("openalex_id", openalex_id), ("year", year)):
        if v and not item.get(k):
            item[k] = v
    if origin not in item["origins"]:
        item["origins"].append(origin)
    return new


# --- sources of preprints -------------------------------------------------------------------

def sync_from_runs(runs_dir=RUNS_DIR):
    """Track every preprint listed in any run's papers.csv. The store is rewritten only when it changes."""
    with locked():
        store = load()
        before, added = dump(store), 0
        for name in sorted(os.listdir(runs_dir)) if os.path.isdir(runs_dir) else []:
            path = os.path.join(runs_dir, name, "papers.csv")
            if not os.path.exists(path):
                continue
            with open(path, encoding="utf-8-sig", newline="") as f:
                for p in csv.DictReader(f):
                    if p.get("section") == "rejected" or not (p.get("section") == "preprint" or p.get("is_preprint") == "True"):
                        continue
                    added += add(store, title=p.get("title"), doi=p.get("verified_doi") or p.get("doi"),
                                 arxiv=p.get("arxiv_id") or "", openalex_id=p.get("openalex_id") or "",
                                 year=int(p["year"]) if (p.get("year") or "").isdigit() else None,
                                 authors=[a.split(" ")[-1] for a in (p.get("authors") or "").split("; ") if a],
                                 origin=f"run:{name}")
        save(store, before)
    return added


def parse_bib(text):
    entries = []
    for m in re.finditer(r"@(\w+)\s*\{\s*([^,\s]+)\s*,(.*?)\n\}", text, re.S):
        fields = {k.lower(): re.sub(r"[{}]", "", v).strip() for k, v in
                  re.findall(r"(\w+)\s*=\s*(\{(?:[^{}]|\{[^{}]*\})*\}|\"[^\"]*\"|\d+)", m.group(3))}
        fields = {k: v.strip('"') for k, v in fields.items()}
        raw = " ".join(fields.values())
        arxiv = fields.get("eprint") if "arxiv" in (fields.get("archiveprefix", "") + fields.get("eprinttype", "")).lower() else ""
        am = ARXIV_RE.search(raw)
        entries.append({"title": fields.get("title", ""), "doi": fields.get("doi", "") or (DOI_RE.search(raw) or [""])[0],
                        "arxiv": arxiv or (am.group(1) if am else ""), "year": fields.get("year"),
                        "authors": [a.split(",")[0].strip() for a in fields.get("author", "").split(" and ") if a],
                        "hint": raw})
    return entries


def parse_markdown(text):
    """Reference entries of a Markdown document: the section under a References heading, one per paragraph or item."""
    m = re.search(r"^#{1,6}\s*(references|bibliography|literatur(verzeichnis)?|quellen)\s*$", text, re.I | re.M)
    body = text[m.end():] if m else text
    nxt = re.search(r"^#{1,6}\s", body, re.M)
    body = body[:nxt.start()] if nxt else body
    entries = []
    for block in re.split(r"\n\s*\n|\n(?=\s*(?:[-*]|\d+\.)\s)", body):
        block = " ".join(block.split())
        if not block:
            continue
        am, dm = ARXIV_RE.search(block), DOI_RE.search(block)
        tm = re.search(r"\((\d{4})[a-z]?\)\.\s*(.+?)\.\s+(?:\*|_|In |https?://)", block)
        entries.append({"title": tm.group(2) if tm else "", "doi": dm.group(0) if dm else "",
                        "arxiv": am.group(1) if am else "", "year": tm.group(1) if tm else None,
                        "authors": re.findall(r"(?:^|&\s|,\s)([A-ZÀ-Ž][\w'\-]+),\s[A-Z]\.", block.split("(")[0]), "hint": block})
    return entries


def import_text(name, text):
    """Track the preprints cited in a references.bib or a Markdown reference list."""
    entries = parse_bib(text) if re.search(r"^\s*@\w+\s*\{", text, re.M) else parse_markdown(text)
    with locked():
        store = load()
        before, added, preprints_found = dump(store), 0, 0
        for e in entries:
            doi = clean_doi(e["doi"])
            if not (e["arxiv"] or is_preprint_doi(doi) or (PREPRINT_VENUES.search(e["hint"]) and doi)):
                continue
            preprints_found += 1
            year = int(e["year"]) if str(e.get("year") or "").isdigit() else None
            added += add(store, title=e["title"], doi=doi, arxiv=e["arxiv"], year=year, authors=e["authors"],
                         origin=f"import:{name}")
        store["imports"] = [i for i in store["imports"] if i["name"] != name] + [
            {"name": name, "added": now(), "entries": len(entries), "preprints": preprints_found}]
        save(store, before)
    return {"entries": len(entries), "preprints": preprints_found, "new": added}


# --- OpenReview ---------------------------------------------------------------------------------

def openreview_enabled():
    cfg = miniyaml.load(os.path.join(SKILL_DIR, "config.yaml")) or {}
    return ((cfg.get("sources") or {}).get("openreview") or {}).get("enabled", True)


def due(item, force=False):
    if force or not item.get("or_checked"):
        return True
    return (datetime.datetime.now() - datetime.datetime.fromisoformat(item["or_checked"])).days >= RECHECK_DAYS


def check_openreview(force=False, log=lambda m: print(m, file=sys.stderr)):
    """Look up the OpenReview decision of due preprints; returns the ones newly found accepted."""
    if not openreview_enabled():
        return []
    items = [it for it in load()["items"].values() if it.get("title") and due(it, force)]
    if not items:
        return []
    log(f"checking {len(items)} preprints at OpenReview")
    cache = extra_sources.Cache("openreview")
    found = []
    for it in items:
        try:
            r = extra_sources.openreview_lookup(it["title"], cache, it.get("year"))
        except Exception as e:
            print(f"  [warn] OpenReview lookup failed: {e}", file=sys.stderr)
            continue
        was = (it.get("openreview") or {}).get("status")
        it["openreview"] = r
        it["or_checked"] = now()
        if r and r["status"] == "accepted" and was != "accepted":
            found.append(it)
    cache.save()
    # the lookups took minutes: merge into the store as it is now, so a sync or import meanwhile is kept
    with locked():
        current = load()
        before = dump(current)
        for it in items:
            seen = current["items"].get(it["id"])
            if not seen:
                continue
            seen["openreview"], seen["or_checked"] = it.get("openreview"), it.get("or_checked")
        save(current, before)
    return found


def report(it):
    return f"Preprint „{it['title'] or it['doi']}“ ist jetzt angenommen: {it['openreview']['venue']} (OpenReview, noch ohne DOI)"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("sync")
    imp = sub.add_parser("import")
    imp.add_argument("files", nargs="+")
    c = sub.add_parser("openreview")
    c.add_argument("--all", action="store_true", help="also preprints looked up in the last days")
    sub.add_parser("list").add_argument("--json", action="store_true")
    args = ap.parse_args()
    if args.cmd == "sync":
        print(f"{sync_from_runs()} new preprints from runs")
    elif args.cmd == "import":
        for f in args.files:
            with open(f, encoding="utf-8") as fh:
                print(f, import_text(os.path.basename(f), fh.read()))
    elif args.cmd == "openreview":
        for it in check_openreview(force=args.all):
            print(report(it))
    elif args.json:
        sync_from_runs()
        print(json.dumps({"items": list(load()["items"].values())}, ensure_ascii=False))
    else:
        for it in load()["items"].values():
            print(f"{it['title'][:80]} · {it['doi']} · {', '.join(it['origins'])}")


if __name__ == "__main__":
    main()
