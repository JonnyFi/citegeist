#!/usr/bin/env python3
"""Research Pipeline preprint tracking: has a tracked preprint been published in a peer-reviewed venue?

Usage:
  python3 preprints.py sync                    # collect the preprints of all runs
  python3 preprints.py import FILE [FILE ...]  # a references.bib or a Markdown reference list
  python3 preprints.py check [--all]           # check due preprints (weekly with every watchlist run)
  python3 preprints.py list

Evidence, per preprint: OpenAlex (a merged work whose DOI or locations point to a journal or
conference, or a separate work with the same title and an author in common), Crossref
"is-preprint-of" relations, DataCite relations for arXiv DOIs, and Semantic Scholar's venue and
DOI. A candidate DOI counts only after it resolves at Crossref or DataCite. Without a verified
DOI a venue is kept as a hint, not as a publication.
"""

import argparse
import csv
import datetime
import json
import os
import re
import sys
import urllib.parse

SKILL_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(SKILL_DIR, "scripts"))
import settings  # noqa: E402  (data folders; imports nothing of ours)

import extra_sources  # noqa: E402
import miniyaml  # noqa: E402
import net  # noqa: E402
import sources  # noqa: E402

RUNS_DIR = settings.RUNS_DIR
WATCH_DIR = settings.WATCH_DIR
STORE = os.path.join(WATCH_DIR, "preprints.json")
RECHECK_DAYS = 6  # a weekly run checks every unpublished preprint once
PREPRINT_DOI_PREFIXES = ("10.48550/", "10.2139/", "10.21203/", "10.1101/", "10.20944/", "10.36227/",
                         "10.22541/", "10.31219/", "10.31234/", "10.31235/", "10.5281/", "10.6084/", "10.17605/")
PREPRINT_VENUES = re.compile(r"arxiv|ssrn|preprint|research square|biorxiv|medrxiv|techrxiv|authorea|"
                             r"chemrxiv|openreview|zenodo|osf|figshare|social science research network", re.I)
WORK_SELECT = "id,doi,title,publication_year,type,authorships,locations,primary_location"
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
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    os.replace(tmp, path)


def load():
    return read_json(STORE, {"items": {}, "imports": []})


def is_preprint_doi(doi):
    return sources.bare_doi(doi).startswith(PREPRINT_DOI_PREFIXES)


def clean_doi(doi):
    return sources.bare_doi(doi).rstrip(".,;)]}")


def norm_title(t):
    return re.sub(r"\s+", " ", re.sub(r"[^\w\s]", " ", (t or "").lower())).strip()


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
                                      "authors": list(authors)[:5], "origins": [], "status": "preprint",
                                      "published": None, "hints": [], "first_seen": now(), "last_checked": None}
    for k, v in (("title", title), ("openalex_id", openalex_id), ("year", year)):
        if v and not item.get(k):
            item[k] = v
    if origin not in item["origins"]:
        item["origins"].append(origin)
    return new


# --- sources of preprints -------------------------------------------------------------------

def sync_from_runs(runs_dir=RUNS_DIR):
    """Track every preprint listed in any run's papers.csv."""
    store, added = load(), 0
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
    write_json(STORE, store)
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
    store, added, preprints_found = load(), 0, 0
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
    write_json(STORE, store)
    return {"entries": len(entries), "preprints": preprints_found, "new": added}


# --- checking ---------------------------------------------------------------------------------

def _doi_from_url(url):
    m = re.match(r"https?://(?:dx\.)?doi\.org/(10\..+)$", url or "", re.I)
    return clean_doi(m.group(1)) if m else ""


def _openalex_batch(filter_key, values):
    out = []
    for i in range(0, len(values), 50):
        chunk = values[i:i + 50]
        try:
            data = net.fetch(f"{sources.OPENALEX}/works", sources._oa(
                {"filter": f"{filter_key}:{'|'.join(chunk)}", "select": WORK_SELECT, "per-page": 50}))
            out += data.get("results") or []
        except Exception as e:
            print(f"  [warn] OpenAlex batch failed: {e}", file=sys.stderr)
    return out


def openalex_evidence(item, work):
    """Published version inside the (possibly merged) OpenAlex work."""
    ev, hints = [], []
    wdoi = clean_doi(work.get("doi"))
    venue = ((work.get("primary_location") or {}).get("source") or {}).get("display_name") or ""
    if wdoi and not is_preprint_doi(wdoi) and wdoi != item["doi"]:
        ev.append({"doi": wdoi, "venue": venue, "via": "OpenAlex (Versionen zusammengeführt)"})
    for loc in work.get("locations") or []:
        src = loc.get("source") or {}
        name = src.get("display_name") or ""
        if not name or PREPRINT_VENUES.search(name) or src.get("type") not in ("journal", "conference", "book series"):
            continue
        doi = _doi_from_url(loc.get("landing_page_url"))
        if doi and not is_preprint_doi(doi):
            ev.append({"doi": doi, "venue": name, "via": "OpenAlex-Location"})
        else:
            hints.append(f"OpenAlex führt eine Version in {name} (ohne DOI)")
    return ev, hints


def openalex_title_match(item):
    """A separate OpenAlex work with the same title, a non-preprint DOI and an author in common."""
    title = norm_title(item["title"])
    if len(title) < 20:
        return []
    try:
        data = net.fetch(f"{sources.OPENALEX}/works", sources._oa(
            {"filter": f"title.search:{title[:200]}", "select": WORK_SELECT, "per-page": 15}))
    except Exception:
        return []
    fams = {a.lower() for a in item.get("authors") or []}
    ev = []
    for w in data.get("results") or []:
        doi = clean_doi(w.get("doi"))
        if norm_title(w.get("title")) != title or not doi or is_preprint_doi(doi) or w.get("type") == "preprint":
            continue
        names = {((a.get("author") or {}).get("display_name") or "").split(" ")[-1].lower() for a in w.get("authorships") or []}
        if fams and not fams & names:
            continue
        venue = ((w.get("primary_location") or {}).get("source") or {}).get("display_name") or ""
        if PREPRINT_VENUES.search(venue):
            continue
        ev.append({"doi": doi, "venue": venue, "year": w.get("publication_year"), "via": "OpenAlex (gleicher Titel)"})
    return ev


def registry_evidence(item):
    """Crossref is-preprint-of for registered preprints; DataCite version relations for arXiv DOIs."""
    doi = item["doi"]
    if not doi:
        return []
    q = urllib.parse.quote(doi, safe="/")
    ev = []
    try:
        if doi.startswith("10.48550/"):
            attrs = net.fetch(f"https://api.datacite.org/dois/{q}")["data"]["attributes"]
            for rel in attrs.get("relatedIdentifiers") or []:
                target = clean_doi(rel.get("relatedIdentifier"))
                if (rel.get("relatedIdentifierType") == "DOI" and target and not is_preprint_doi(target)
                        and rel.get("relationType") in ("IsVersionOf", "IsPreviousVersionOf", "IsIdenticalTo")):
                    ev.append({"doi": target, "venue": "", "via": f"DataCite ({rel['relationType']})"})
        else:
            msg = net.fetch(f"https://api.crossref.org/works/{q}", net.with_mailto({}))["message"]
            for rel in (msg.get("relation") or {}).get("is-preprint-of") or []:
                target = clean_doi(rel.get("id"))
                if rel.get("id-type") == "doi" and target:
                    ev.append({"doi": target, "venue": "", "via": "Crossref (is-preprint-of)"})
    except net.NotFound:
        pass
    except Exception as e:
        print(f"  [warn] registry lookup failed for {doi}: {e}", file=sys.stderr)
    return ev


def s2_evidence(items):
    """Semantic Scholar venue and DOI, one batch request."""
    ids = {}
    for it in items:
        ids[f"ARXIV:{it['arxiv_id']}" if it["arxiv_id"] else f"DOI:{it['doi']}"] = it["id"]
    out = {}
    keys = list(ids)
    for i in range(0, len(keys), 400):
        chunk = keys[i:i + 400]
        try:
            data = net.fetch("https://api.semanticscholar.org/graph/v1/paper/batch",
                             {"fields": "venue,publicationVenue,externalIds,journal,year"}, data={"ids": chunk})
        except Exception as e:
            print(f"  [warn] Semantic Scholar unavailable: {e}", file=sys.stderr)
            return out
        for key, rec in zip(chunk, data):
            if not rec:
                continue
            venue = (rec.get("publicationVenue") or {}).get("name") or rec.get("venue") or (rec.get("journal") or {}).get("name") or ""
            doi = clean_doi((rec.get("externalIds") or {}).get("DOI"))
            ev, hints = [], []
            if doi and not is_preprint_doi(doi):
                ev.append({"doi": doi, "venue": "" if PREPRINT_VENUES.search(venue) else venue, "via": "Semantic Scholar"})
            elif venue and not PREPRINT_VENUES.search(venue):
                hints.append(f"Semantic Scholar nennt die Venue {venue} (ohne DOI)")
            out[ids[key]] = (ev, hints)
    return out


def doi_details(doi):
    """Venue and year of a verified DOI (OpenAlex, else Crossref)."""
    try:
        w = net.fetch(f"{sources.OPENALEX}/works/doi:{doi}", sources._oa({"select": "publication_year,primary_location,title"}))
        venue = ((w.get("primary_location") or {}).get("source") or {}).get("display_name")
        if venue:
            return venue, w.get("publication_year")
    except Exception:
        pass
    try:
        msg = net.fetch(f"https://api.crossref.org/works/{urllib.parse.quote(doi, safe='/')}", net.with_mailto({}))["message"]
        year = ((msg.get("issued") or {}).get("date-parts") or [[None]])[0][0]
        return (msg.get("container-title") or [""])[0], year
    except Exception:
        return "", None


def openreview_enabled():
    cfg = miniyaml.load(os.path.join(SKILL_DIR, "config.yaml")) or {}
    return ((cfg.get("sources") or {}).get("openreview") or {}).get("enabled", True)


def due(item, force=False):
    if item["status"] == "published":
        return False
    if force or not item.get("last_checked"):
        return True
    return (datetime.datetime.now() - datetime.datetime.fromisoformat(item["last_checked"])).days >= RECHECK_DAYS


def check(force=False, log=lambda m: print(m, file=sys.stderr)):
    """Check due preprints; returns the items newly found to be published."""
    store = load()
    items = [it for it in store["items"].values() if due(it, force)]
    if not items:
        return []
    log(f"checking {len(items)} preprints")
    works = {}
    for w in _openalex_batch("openalex", [it["openalex_id"] for it in items if it.get("openalex_id")]):
        works[w["id"].rsplit("/", 1)[-1]] = w
    by_doi = {clean_doi(w.get("doi")): w for w in
              _openalex_batch("doi", [it["doi"] for it in items if it["doi"] and not it.get("openalex_id")])}
    s2 = s2_evidence(items)
    use_or = openreview_enabled()
    or_cache = extra_sources.Cache("openreview")
    found = []
    for it in items:
        work = works.get(it.get("openalex_id")) or by_doi.get(it["doi"])
        ev, hints = [], []
        if work:
            it["openalex_id"] = it.get("openalex_id") or work["id"].rsplit("/", 1)[-1]
            it["title"] = it["title"] or work.get("title") or ""
            it["year"] = it.get("year") or work.get("publication_year")
            if not it.get("authors"):
                it["authors"] = [((a.get("author") or {}).get("display_name") or "").split(" ")[-1]
                                 for a in (work.get("authorships") or [])[:5]]
            e, h = openalex_evidence(it, work)
            ev += e
            hints += h
        ev += registry_evidence(it)
        e, h = s2.get(it["id"], ([], []))
        ev += e
        hints += h
        if not ev:
            ev += openalex_title_match(it)
        it["last_checked"] = now()
        it["hints"] = sorted(set(hints))
        ev = [c for c in ev if clean_doi(c["doi"]) != it["doi"]]  # the preprint's own DOI is no new version
        verified = None
        for cand in ev:
            vdoi, reg = sources.verify_doi(cand["doi"])
            if vdoi:
                verified = {**cand, "doi": vdoi, "registry": reg}
                break
        if verified:
            venue, year = doi_details(verified["doi"])
            if PREPRINT_VENUES.search(verified.get("venue") or ""):  # a merged work's primary location can be arXiv
                verified["venue"] = ""
            if PREPRINT_VENUES.search(venue or ""):
                venue = ""
            verified.update(venue=verified.get("venue") or venue or "unbekannter Venue", year=verified.get("year") or year,
                            via=sorted({c["via"] for c in ev if clean_doi(c["doi"]) == verified["doi"]}) or [verified["via"]],
                            found=now())
            it["status"], it["published"] = "published", verified
            found.append(it)
        elif use_or and it.get("title"):
            try:
                r = extra_sources.openreview_lookup(it["title"], or_cache, it.get("year"))
            except Exception as e:
                r = None
                print(f"  [warn] OpenReview lookup failed: {e}", file=sys.stderr)
            was = (it.get("openreview") or {}).get("status")
            it["openreview"] = r
            if r and r["status"] == "accepted":
                it["status"] = "accepted"
                if was != "accepted":
                    found.append(it)
            elif hints:
                it["status"] = "hint"
        elif hints:
            it["status"] = "hint"
    or_cache.save()
    write_json(STORE, store)
    return found


def report(it):
    if it["status"] == "accepted":
        r = it["openreview"]
        return f"Preprint „{it['title'] or it['doi']}“ ist jetzt angenommen: {r['venue']} (OpenReview, noch ohne DOI)"
    p = it["published"]
    title = it["title"] or it["doi"]
    year = f" ({p['year']})" if p.get("year") else ""
    return f"Preprint „{title}“ ist jetzt erschienen in {p['venue']}{year} – DOI {p['doi']}"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("sync")
    imp = sub.add_parser("import")
    imp.add_argument("files", nargs="+")
    c = sub.add_parser("check")
    c.add_argument("--all", action="store_true", help="also preprints checked in the last days")
    sub.add_parser("list")
    args = ap.parse_args()
    if args.cmd == "sync":
        print(f"{sync_from_runs()} new preprints from runs")
    elif args.cmd == "import":
        for f in args.files:
            with open(f, encoding="utf-8") as fh:
                print(f, import_text(os.path.basename(f), fh.read()))
    elif args.cmd == "check":
        for it in check(force=args.all):
            print(report(it))
    else:
        for it in sorted(load()["items"].values(), key=lambda i: i["status"]):
            print(f"[{it['status']}] {it['title'][:80]} · {it['doi']} · {', '.join(it['origins'])}")


if __name__ == "__main__":
    main()
