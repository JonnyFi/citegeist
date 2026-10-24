#!/usr/bin/env python3
"""Research Pipeline: find, rank and verify papers for a research topic.

Usage:
  python3 pipeline.py --topic "TOPIC" --query "q1" --query "q2" ... [--since 2022] [--top 30]

Writes papers.md, summaries.md, papers.csv and references.bib to --out (default: cwd).
"""

import argparse
import contextlib
import datetime
import hashlib
import json
import os
import re
import sys
import time
import traceback

SKILL_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(SKILL_DIR, "scripts"))

import extra_sources  # noqa: E402
import miniyaml  # noqa: E402
import net  # noqa: E402
import render  # noqa: E402
import settings  # noqa: E402
import sources  # noqa: E402
from score import VenueIndex, score_paper  # noqa: E402

PREPRINT_DOI_PREFIXES = (
    "10.48550/",  # arXiv
    "10.2139/",  # SSRN
    "10.21203/",  # Research Square
    "10.1101/",  # bioRxiv / medRxiv
    "10.20944/",  # Preprints.org
    "10.36227/",  # TechRxiv
    "10.22541/",  # Authorea
)
GREY_DOI_PREFIXES = (
    "10.5281/",  # Zenodo
    "10.6084/",  # Figshare
    "10.17605/", "10.31219/", "10.31234/", "10.31235/",  # OSF, OSF Preprints, PsyArXiv, SocArXiv
)
PREPRINT_SERVERS = []  # source-name terms, from config.yaml
GREY_HOSTS = []  # source-name terms, from config.yaml


# --- progress events (--progress-jsonl) -------------------------------------------

STAGES = [
    ("search", "Search OpenAlex and arXiv"),
    ("resolve", "Resolve arXiv hits in OpenAlex"),
    ("filter", "Dedup, filter, relevance gate"),
    ("authors", "Author h-index (OpenAlex)"),
    ("orcid", "Merge split author profiles (ORCID)"),
    ("s2", "Semantic Scholar"),
    ("score", "Score"),
    ("dblp", "Venues and tracks (DBLP)"),
    ("openreview", "Review status (OpenReview)"),
    ("verify", "Verify DOIs"),
    ("snowball", "Snowballing"),
    ("snowball_authors", "Author h-index (snowball papers)"),
    ("snowball_orcid", "Merge split author profiles (snowball papers)"),
    ("snowball_s2", "Semantic Scholar (snowball papers)"),
    ("snowball_dblp", "DBLP (snowball papers)"),
    ("snowball_openreview", "OpenReview (snowball papers)"),
    ("snowball_verify", "Re-score and verify"),
    ("write", "Write outputs"),
]
PROGRESS = None  # stream for JSON-lines events, set by --progress-jsonl


def emit(kind, **data):
    if PROGRESS:
        PROGRESS.write(json.dumps({"type": kind, "t": round(time.time(), 3), **data}) + "\n")
        PROGRESS.flush()


@contextlib.contextmanager
def stage(sid):
    emit("stage", stage=sid, status="started")
    start = time.time()
    try:
        yield
    except BaseException:
        emit("stage", stage=sid, status="failed")
        raise
    emit("stage", stage=sid, status="finished", seconds=round(time.time() - start, 1))


def counter(sid, done, total, label):
    emit("counter", stage=sid, done=done, total=total, label=label)


def log(msg):
    print(msg, file=sys.stderr)
    emit("log", msg=msg.strip())


def warn(msg):
    print(f"  [warn] {msg}", file=sys.stderr)
    emit("warning", msg=msg)


def clean_title(t):
    """Collapse whitespace, including literal '\\n' escapes some OpenAlex titles contain."""
    return re.sub(r"(\\n|\s)+", " ", t or "").strip()


def _text(s):
    return " " + " ".join(re.findall(r"\w+", (s or "").lower())) + " "


def _word_pattern(word):
    # light stemming: "agents" matches agent/agents/agentic; short words must match exactly
    stem = word[:-1] if len(word) > 4 and word.endswith("s") else word
    return rf"\b{re.escape(stem)}\b" if len(stem) <= 3 else rf"\b{re.escape(stem)}\w*"


def _has_word(text, word):
    return re.search(_word_pattern(word), text) is not None


def _has_phrase(text, phrase):
    # same stemming per word: "self improvement" matches "self-improvements"
    return re.search(r"\s".join(_word_pattern(w) for w in phrase.split()), text) is not None


def matches_query(p, parsed_queries):
    """Relevance gate: title+abstract contain every phrase and word of at least one query."""
    text = _text(p["title"] + " " + (p.get("abstract") or ""))
    for phrases, words in parsed_queries:
        if all(_has_phrase(text, ph) for ph in phrases) and all(_has_word(text, w) for w in words):
            return True
    return False


def _names(name, terms):
    n = (name or "").lower()
    return any(re.search(rf"(?<!\w){re.escape(t)}(?!\w)", n) for t in terms)


def is_preprint_server(name):
    return _names(name, PREPRINT_SERVERS)


def is_grey_host(name):
    return _names(name, GREY_HOSTS)


def norm_title(t):
    return re.sub(r"\s+", " ", re.sub(r"[^\w\s]", " ", (t or "").lower())).strip()


# --- per-query cache (--query-cache) ------------------------------------------------

class QueryCache:
    """One JSON file per (source, query, search settings), so a resumed run skips finished queries.

    Only successful searches are stored; a failed arXiv search is retried on resume.
    """

    def __init__(self, path, n, since, exclude):
        self.path, self.settings = path, {"n": n, "since": since, "exclude": sorted(exclude)}
        os.makedirs(path, exist_ok=True)

    def _file(self, source, query):
        key = json.dumps({"source": source, "query": query, **self.settings}, sort_keys=True)
        return os.path.join(self.path, f"{source}-{hashlib.sha1(key.encode()).hexdigest()[:16]}.json")

    def get(self, source, query):
        try:
            with open(self._file(source, query), encoding="utf-8") as f:
                return json.load(f)["results"]
        except (OSError, ValueError, KeyError):
            return None

    def put(self, source, query, results):
        path = self._file(source, query)
        with open(path + ".tmp", "w", encoding="utf-8") as f:
            json.dump({"source": source, "query": query, **self.settings,
                       "fetched": datetime.datetime.now().isoformat(timespec="seconds"),
                       "results": results}, f, ensure_ascii=False)
        os.replace(path + ".tmp", path)


def cached_search(cache, source, query, search):
    """Run `search()` unless `cache` has this query already. Returns (results, from_cache)."""
    hit = cache.get(source, query) if cache else None
    if hit is not None:
        return hit, True
    results = search()
    if cache:
        cache.put(source, query, results)
    return results, False


# --- building paper records ---------------------------------------------------

def paper_from_openalex(w, venues):
    doi = sources.bare_doi(w.get("doi"))
    candidates = []  # (name, source_type)
    for loc in [w.get("primary_location") or {}] + (w.get("locations") or []):
        src = loc.get("source") or {}
        name = src.get("display_name") or loc.get("raw_source_name")
        if name:
            candidates.append((name, src.get("type") or ""))
    # Published venue = any non-repository location. Untyped locations (raw names only)
    # count unless they name a preprint server / grey host or the DOI belongs to one.
    hosted_doi = doi.startswith(PREPRINT_DOI_PREFIXES + GREY_DOI_PREFIXES)
    other = lambda c: not is_preprint_server(c[0]) and not is_grey_host(c[0])
    typed = [c for c in candidates if c[1] and c[1] != "repository" and other(c)]
    untyped = [c for c in candidates if not c[1] and other(c)]
    published = typed if hosted_doi else typed + untyped

    venue, venue_type, match = "", "", None
    for name, stype in published:
        m = venues.match(name)
        if m and (match is None or m[1] < match[1]):
            venue, venue_type, match = name, stype, m
    if not venue and published:
        venue, venue_type = published[0]

    # Grey literature: hosted only on Zenodo / OSF / Figshare (wins over preprint).
    # Preprint: OpenAlex type "preprint" (unless a tiered venue is listed), or only on a
    # preprint server. Other repository-only records stay in the main list, venue unknown.
    if candidates:
        is_grey = not published and all(is_grey_host(c[0]) for c in candidates)
    else:
        is_grey = doi.startswith(GREY_DOI_PREFIXES)
    servers = [c for c in candidates if is_preprint_server(c[0])]
    is_preprint = not is_grey and (
        (w.get("type") == "preprint" and not match)
        or (not published and (bool(servers) or doi.startswith(PREPRINT_DOI_PREFIXES)))
    )
    found_in = ""
    if (is_grey or is_preprint) and not match:
        hosts = [c for c in candidates if is_grey_host(c[0])] if is_grey else servers
        if hosts or candidates:
            venue, venue_type = (hosts or candidates)[0]
    elif not published and candidates:
        found_in = candidates[0][0]

    authors, author_ids, institutions = [], [], []
    for a in w.get("authorships") or []:
        au = a.get("author") or {}
        authors.append(au.get("display_name") or a.get("raw_author_name") or "")
        if au.get("id"):
            author_ids.append(sources.short_id(au["id"]))
        for inst in a.get("institutions") or []:
            if inst.get("display_name") and inst["display_name"] not in institutions:
                institutions.append(inst["display_name"])

    abstract = sources.reconstruct_abstract(w.get("abstract_inverted_index"))
    biblio = w.get("biblio") or {}
    return {
        "openalex_id": sources.short_id(w.get("id")),
        "title": clean_title(w.get("title")),
        "authors": [a for a in authors if a],
        "author_ids": author_ids,
        "institutions": institutions,
        "year": w.get("publication_year"),
        "publication_date": w.get("publication_date") or "",
        "venue": venue,
        "venue_type": venue_type,
        "found_in": found_in,
        "venue_canonical": match[0] if match else "",
        "venue_tier": match[1] if match else None,
        "venue_field": match[2] if match else "",
        "type": w.get("type") or "",
        "doi": doi,
        "arxiv_id": sources.arxiv_id_from_work(w),
        "is_preprint": is_preprint,
        "is_grey": is_grey,
        "cited_by_count": w.get("cited_by_count"),
        "fwci": w.get("fwci"),
        "abstract": abstract,
        "abstract_source": "OpenAlex" if abstract else "",
        "volume": biblio.get("volume") or "",
        "issue": biblio.get("issue") or "",
        "pages": "-".join(dict.fromkeys(x for x in (biblio.get("first_page"), biblio.get("last_page")) if x)),
        "referenced_works": [sources.short_id(r) for r in w.get("referenced_works") or []],
        "sources": {"OpenAlex"},
        "queries": set(),
        "relevance": None,
        "relevance_note": "",
        "snowball": "",
    }


def paper_from_arxiv(e):
    return {
        "openalex_id": "", "title": clean_title(e["title"]), "authors": e["authors"], "author_ids": [],
        "institutions": [], "year": int(e["published"][:4]) if e["published"] else None,
        "publication_date": e["published"], "venue": "arXiv", "venue_type": "repository", "found_in": "",
        "venue_canonical": "", "venue_tier": None, "venue_field": "", "type": "preprint", "doi": "",
        "arxiv_id": e["arxiv_id"], "is_preprint": True, "is_grey": False,
        "cited_by_count": None, "fwci": None,
        "abstract": e["abstract"], "abstract_source": "arXiv" if e["abstract"] else "",
        "volume": "", "issue": "", "pages": "", "referenced_works": [], "sources": {"arXiv"},
        "queries": set(), "relevance": None, "relevance_note": "", "snowball": "",
    }


# --- deduplication ------------------------------------------------------------

def _preference(p):
    # The version with the best venue tier is the one that gets scored.
    tier = {1: 2, 2: 1}.get(p.get("venue_tier"), 0)
    return (tier, not p["is_preprint"] and not p["is_grey"], bool(p["doi"]), bool(p["openalex_id"]),
            p.get("cited_by_count") or 0)


def _merge(group):
    group = sorted(group, key=_preference, reverse=True)
    keep = group[0]
    for other in group[1:]:
        keep["queries"] |= other["queries"]
        keep["sources"] |= other["sources"]
        if not keep["arxiv_id"] and other["arxiv_id"]:
            keep["arxiv_id"] = other["arxiv_id"]
        if not keep["abstract"] and other["abstract"]:
            keep["abstract"], keep["abstract_source"] = other["abstract"], other["abstract_source"]
        if (other.get("relevance") or -1) > (keep.get("relevance") or -1):
            keep["relevance"], keep["relevance_note"] = other["relevance"], other["relevance_note"]
        if not keep["snowball"] and other["snowball"]:
            keep["snowball"] = other["snowball"]
        for k in ("referenced_works", "author_ids"):
            if not keep.get(k) and other.get(k):
                keep[k] = other[k]
    return keep


def deduplicate(papers):
    def collapse(items, key_fn):
        groups, order = {}, []
        for p in items:
            k = key_fn(p)
            if not k:
                order.append([p])
                continue
            if k not in groups:
                groups[k] = []
                order.append(groups[k])
            groups[k].append(p)
        return [_merge(g) for g in order]

    by_doi = collapse(papers, lambda p: p["doi"])
    return collapse(by_doi, lambda p: norm_title(p["title"]) if len(norm_title(p["title"])) > 15 else "")


# --- pipeline -----------------------------------------------------------------

def load_config(args):
    cfg = miniyaml.load(os.path.join(SKILL_DIR, "config.yaml"))
    venues = miniyaml.load(os.path.join(SKILL_DIR, "venues.yaml"))
    inst = miniyaml.load(os.path.join(SKILL_DIR, "institutions.yaml")) or {}
    if args.since is not None:
        cfg["since"] = args.since
    if args.top is not None:
        cfg["max_results"] = args.top
    if args.per_query is not None:
        cfg["results_per_query"] = args.per_query
    if args.max_queries is not None:
        cfg["max_queries"] = args.max_queries
    listed = {str(i).lower() for i in (inst.get("institutions") or [])}
    src = cfg.get("sources") or {}
    defaults = {"dblp": {"enabled": True, "max_papers": 120}, "openreview": {"enabled": True, "max_papers": 30},
                "unpaywall": {"enabled": True}, "orcid": {"enabled": True, "max_authors": 300}}
    cfg["sources"] = {k: {**v, **(src.get(k) or {})} for k, v in defaults.items()}
    for name in getattr(args, "disable_source", None) or []:
        cfg["sources"][name]["enabled"] = False
    PREPRINT_SERVERS[:] = [str(s).lower() for s in cfg.get("preprint_servers") or []]
    GREY_HOSTS[:] = [str(s).lower() for s in cfg.get("grey_literature_hosts") or []]
    return cfg, VenueIndex(venues), listed


def filter_pool(papers, cfg, parsed_queries, exclude):
    """Type/year filter and relevance gate. Returns (kept, excluded count, gated-out count)."""
    since = cfg.get("since")
    ok = [p for p in papers if p["title"] and p["type"] not in exclude
          and (not since or (p["year"] and p["year"] >= since))]
    excluded = len(papers) - len(ok)
    if not cfg.get("relevance_gate", True):
        return ok, excluded, 0
    kept = [p for p in ok if matches_query(p, parsed_queries)]
    return kept, excluded, len(ok) - len(kept)


def enrich(papers, cfg, stages=("authors", "orcid", "s2")):
    """Author h-index (max of OpenAlex, ORCID-merged OpenAlex profiles and Semantic Scholar),
    S2 TLDR and influential citations."""
    todo = [p for p in papers if not p.get("_enriched")]
    ids = sorted({a for p in todo for a in p["author_ids"]})
    with stage(stages[0]):
        authors = sources.openalex_authors(
            ids, settings.CACHE_DIR,
            progress=lambda d, t: counter(stages[0], d, t, f"authors fetched ({len(ids) - t} cached)"))

    merged = {}
    oc = cfg["sources"]["orcid"]
    if oc.get("enabled"):
        with stage(stages[1]):
            merged = orcid_merge(todo, authors, cfg, stages[1])
    else:
        emit("stage", stage=stages[1], status="skipped")

    keys = {}
    for p in todo:
        if p["doi"]:
            keys[id(p)] = f"DOI:{p['doi']}"
        elif p["arxiv_id"]:
            keys[id(p)] = f"ARXIV:{p['arxiv_id']}"
    with stage(stages[2]):
        log(f"Semantic Scholar: {len(keys)} papers")
        s2 = sources.semantic_scholar(list(keys.values()))
        counter(stages[2], len(s2), len(keys), "papers found")

    for p in todo:
        hs = [(authors[a]["h_index"], authors[a]["name"], "OpenAlex") for a in p["author_ids"]
              if a in authors and authors[a].get("h_index") is not None and a not in merged]
        notes = []
        for a in p["author_ids"]:
            if a in merged:
                m = merged[a]
                hs.append((m["h"], authors.get(a, {}).get("name") or m["members"][0]["name"], "OpenAlex+ORCID"))
                own = authors.get(a, {}).get("h_index")
                notes.append(f"{m['members'][0]['name']}: h {m['h']} over {len(m['members'])} OpenAlex profiles "
                             f"merged via ORCID {m['orcid']} (this paper's profile {a}: h {own})")
        rec = s2.get(keys.get(id(p)), {})
        hs += [(a["hIndex"], a.get("name") or "", "Semantic Scholar")
               for a in rec.get("authors") or [] if a.get("hIndex") is not None]
        best = max(hs, key=lambda h: h[0]) if hs else (None, "", "")
        p["max_h_index"], p["max_h_author"], p["max_h_source"] = best
        p["h_index_note"] = "; ".join(dict.fromkeys(notes))
        p["influential_citations"] = rec.get("influentialCitationCount")
        p["tldr"] = ((rec.get("tldr") or {}).get("text") or "").strip()
        p["_enriched"] = True
    return len(s2)


def orcid_merge(todo, authors, cfg, sid):
    """Check the authors of the most relevant papers for split OpenAlex profiles (ORCID)."""
    cap = cfg["scoring"]["h_index_cap"]
    limit = cfg["sources"]["orcid"].get("max_authors") or 300
    top, rest = [], []
    for p in sorted(todo, key=lambda p: -(p.get("relevance") or 0)):
        known = [(authors[a]["h_index"] or 0, a) for a in p["author_ids"] if a in authors]
        if known and max(known)[0] >= cap:
            # the author score is already at its maximum; only the reported h of the top author can change
            top.append(max(known)[1])
        else:
            rest += [a for _, a in known]
    chosen = list(dict.fromkeys(top + rest))[:limit]
    log(f"ORCID: checking {len(chosen)} authors for split OpenAlex profiles")
    profiles = {a: {"id": a, **{k: authors[a].get(k) for k in ("name", "h_index", "orcid", "inst_ids", "inst_names")}}
                for a in chosen}
    for pr in profiles.values():
        pr["inst_ids"], pr["inst_names"] = pr["inst_ids"] or [], pr["inst_names"] or []
    try:
        merged = extra_sources.orcid_merge(profiles, progress=lambda d, t: counter(sid, d, t, "authors checked"))
    except Exception as e:
        warn(f"ORCID merge failed ({type(e).__name__}: {e}); h-indices stay unmerged")
        return {}
    groups = {m["orcid"]: m for m in merged.values()}
    for m in groups.values():
        members = ", ".join(f"{x['name']} ({x['id']}, h {x['h']})" for x in m["members"])
        log(f"ORCID {m['orcid']}: merged {members} -> h {m['h']}")
    return merged


def top_candidates(papers, cfg, factor=1.5):
    """The papers that can still reach a list: the best-scored main-list and preprint candidates."""
    main = sorted([p for p in papers if not p["is_preprint"] and not p["is_grey"]], key=lambda p: -p["score"])
    pre = sorted([p for p in papers if p["is_preprint"]], key=lambda p: -p["score"])
    return (main[:int(cfg["max_results"] * factor) + 1], pre[:int(cfg["max_preprints"] * factor) + 1])


def apply_dblp(papers, venues, cfg, sid):
    """Venue and track from DBLP; where DBLP disagrees with OpenAlex, DBLP wins and the note says so."""
    limit = cfg["sources"]["dblp"].get("max_papers") or 120
    main, pre = top_candidates(papers, cfg)
    todo = [p for p in main + pre if not p.get("_dblp")][:limit]
    if not todo:
        counter(sid, 0, 0, "papers")
        return 0
    try:
        found = extra_sources.dblp_lookup(todo, progress=lambda d, t: counter(sid, d, t, "papers looked up"))
    except Exception as e:
        warn(f"DBLP unavailable ({type(e).__name__}: {e}); venues stay as OpenAlex has them")
        return 0
    changed = 0
    for p in todo:
        p["_dblp"] = True
        recs = [{**r, "track": extra_sources.dblp_track(r)} for r in found.get(id(p)) or []]
        doi = (p.get("doi") or "").lower()
        exact = [r for r in recs if r["doi"] and r["doi"] == doi and r["track"] != "informal"]
        formal = [r for r in recs if r["track"] != "informal"]
        rec = exact[0] if exact else None
        if not rec and formal and not p["is_preprint"]:
            same_year = [r for r in formal if r.get("year") and p.get("year") and abs(int(r["year"]) - int(p["year"])) <= 1]
            rec = same_year[0] if same_year else None
        if p["is_preprint"] and not exact and formal:
            r = formal[0]
            p["venue_note"] = (f"DBLP lists a published version: {r['venue']} {r.get('year') or ''} ({r['track']})"
                               + (f", DOI {r['doi']}" if r["doi"] else "")).strip()
            p["dblp_venue"], p["dblp_track"], p["dblp_key"] = r["venue"], r["track"], r["rec"].rsplit("/rec/", 1)[-1]
            continue
        if not rec:
            continue
        p["dblp_venue"], p["dblp_track"], p["dblp_key"] = rec["venue"], rec["track"], rec["rec"].rsplit("/rec/", 1)[-1]
        m = venues.match(rec["venue"])
        old = f"{p['venue'] or 'none'}" + (f" (tier {p['venue_tier']})" if p.get("venue_tier") else "")
        if rec["track"] in ("workshop", "findings"):
            # not the main conference: unlisted unless venues.yaml lists this venue itself
            label = rec["venue"] if rec["track"] == "findings" else f"{rec['venue']} (workshop)"
            own = venues.match(rec.get("proc") or "") if rec["track"] == "findings" else None
            if p.get("venue_tier") and not own or not p.get("venue"):
                p["venue"], p["venue_canonical"], p["venue_tier"], p["venue_field"] = label, "", None, ""
                p["venue_note"] = (f"DBLP: {rec['track']} paper ({rec['venue']}, {rec.get('proc') or rec['track'] + ' proceedings'}); "
                                   f"OpenAlex: {old}")
                changed += 1
        elif m and m[0] != p.get("venue_canonical"):
            p["venue_note"] = f"DBLP: {rec['venue']} ({rec['track']}); OpenAlex: {old}"
            p["venue"], p["venue_canonical"], p["venue_tier"], p["venue_field"] = m[0], m[0], m[1], m[2]
            p["found_in"] = ""
            changed += 1
        elif not p.get("venue") and rec["venue"]:
            p["venue_note"] = f"venue from DBLP: {rec['venue']} ({rec['track']}); OpenAlex had none"
            p["venue"], p["found_in"] = rec["venue"], ""
            changed += 1
    log(f"DBLP: {sum(1 for p in todo if p.get('dblp_venue'))} of {len(todo)} papers found, {changed} venues corrected")
    return changed


def apply_openreview(papers, cfg, sid):
    """Review status and venue from OpenReview for preprints and AI/ML papers (by title)."""
    limit = cfg["sources"]["openreview"].get("max_papers") or 40
    main, pre = top_candidates(papers, cfg, factor=1.2)
    ml = [p for p in main if p.get("venue_field") in ("ai_ml", "") and (p.get("year") or 0) >= 2017]
    todo = [p for p in pre + ml if not p.get("_openreview")][:limit]
    cache = extra_sources.Cache("openreview")
    found = 0
    try:
        for i, p in enumerate(todo, 1):
            p["_openreview"] = True
            try:
                r = extra_sources.openreview_lookup(p["title"], cache, p.get("year"))
            except Exception as e:
                warn(f"OpenReview lookup failed for {p['title'][:50]!r}: {e}")
                continue
            if r:
                p["openreview_status"], p["openreview_venue"], p["openreview_forum"] = r["status"], r["venue"], r["forum"]
                found += 1
            counter(sid, i, len(todo), f"papers looked up ({found} found)")
    finally:
        cache.save()
    log(f"OpenReview: {found} of {len(todo)} papers found")
    return found


def score_all(papers, cfg, listed_inst):
    for p in papers:
        if p.get("relevance") is None:
            p["relevance"] = cfg["unranked_relevance"]
            p["relevance_note"] = "snowballing" if p["snowball"] else "no query rank"
        score_paper(p, cfg, listed_inst)


def select_sections(papers, cfg, verify_cache, sid="verify"):
    """Rank each section by score and verify DOIs until it is full."""
    rejected = []
    main_pool = [p for p in papers if not p["is_preprint"] and not p["is_grey"]]
    pools = [(main_pool, cfg["max_results"]),
             ([p for p in papers if p["is_preprint"]], cfg["max_preprints"]),
             ([p for p in papers if p["is_grey"]], cfg["max_grey"])]
    target = sum(min(limit, len(pool)) for pool, limit in pools)
    accepted = [0]

    def select(pool, limit):
        chosen = []
        for p in sorted(pool, key=lambda p: p["score"], reverse=True):
            if len(chosen) >= limit:
                break
            for k in ("doi_origin", "rejected_reason", "verified_doi", "verified_by"):
                p.pop(k, None)
            doi = p["doi"]
            if not doi and p["arxiv_id"]:
                doi = f"10.48550/arXiv.{p['arxiv_id']}"
                p["doi_origin"] = "arXiv DOI (no DOI in OpenAlex)"
            if not doi:
                p["rejected_reason"] = "no DOI (and no arXiv version)"
                rejected.append(p)
                continue
            if doi.lower() not in verify_cache:
                verify_cache[doi.lower()] = sources.verify_doi(doi)
            verified, info = verify_cache[doi.lower()]
            if verified:
                p["verified_doi"], p["verified_by"] = verified, info
                chosen.append(p)
                accepted[0] += 1
            else:
                p["rejected_reason"] = f"{info} ({doi})"
                rejected.append(p)
            counter(sid, accepted[0], target, f"verified ({len(rejected)} rejected)")
        return chosen

    main_list, preprints, grey = (select(pool, limit) for pool, limit in pools)
    return main_list, preprints, grey, rejected


def snowball(seeds, known, venues, cfg):
    """References and citing works of the seeds (OpenAlex), minus papers already known."""
    per_seed = cfg["snowball"]["citing_per_seed"]
    works = []  # (work, note)
    ref_owner = {}
    for s in seeds:
        for r in s["referenced_works"]:
            ref_owner.setdefault(r, s)
    log(f"Snowballing: {len(seeds)} seeds, {len(ref_owner)} references, up to {per_seed} citing works each")
    counter("snowball", 0, len(seeds) + 1, "requests: references + citing works per seed")
    for w in sources.openalex_by_ids(list(ref_owner)):
        works.append((w, f"reference of: {ref_owner[sources.short_id(w['id'])]['title'][:60]}"))
    counter("snowball", 1, len(seeds) + 1, "references fetched")
    for i, s in enumerate(seeds, 1):
        for w in sources.openalex_citing(s["openalex_id"], per_seed):
            works.append((w, f"cites: {s['title'][:60]}"))
        counter("snowball", i + 1, len(seeds) + 1, f"citing works of seed {i}/{len(seeds)}")
    new = []
    for w, note in works:
        if sources.short_id(w.get("id")) in known:
            continue
        p = paper_from_openalex(w, venues)
        p["snowball"] = note
        new.append(p)
    return new


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--topic", required=True)
    ap.add_argument("--query", action="append", required=True, help="repeat for each search query")
    ap.add_argument("--since", type=int, help="earliest publication year")
    ap.add_argument("--top", type=int, help="max peer-reviewed papers in the final list")
    ap.add_argument("--per-query", type=int, help="candidates per query and source")
    ap.add_argument("--max-queries", type=int, help="max search queries after dropping plural/case variants")
    ap.add_argument("--query-cache", help="folder for per-query results; a rerun with the same folder "
                    "skips queries that already finished")
    ap.add_argument("--disable-source", action="append", default=[], choices=["dblp", "openreview", "unpaywall", "orcid"],
                    help="switch off an optional source for this run (repeatable); config.yaml sets the default")
    ap.add_argument("--out", default=os.getcwd())
    ap.add_argument("--progress-jsonl", action="store_true",
                    help="print one JSON object per progress event on stdout (summary goes to stderr)")
    args = ap.parse_args()
    global PROGRESS
    if args.progress_jsonl:
        PROGRESS = sys.stdout
        net.on_retry = lambda m: warn(f"retry: {m}")
        sources.log, sources.warn = log, warn
    emit("plan", stages=[{"id": s, "label": label} for s, label in STAGES])
    try:
        run(args)
    except KeyboardInterrupt:
        emit("error", msg="interrupted")
        sys.exit(130)
    except Exception as e:
        emit("error", msg=f"{type(e).__name__}: {e}", traceback=traceback.format_exc())
        raise


def external_lookups(papers, venues, cfg, listed_inst, sids):
    """DBLP venues (then re-score, since tiers may change) and OpenReview status, each its own stage."""
    for name, sid, fn in (("dblp", sids[0], lambda: apply_dblp(papers, venues, cfg, sids[0])),
                          ("openreview", sids[1], lambda: apply_openreview(papers, cfg, sids[1]))):
        if not cfg["sources"][name].get("enabled"):
            emit("stage", stage=sid, status="skipped")
            continue
        with stage(sid):
            if fn() and name == "dblp":
                score_all(papers, cfg, listed_inst)


def run(args):
    cfg, venues, listed_inst = load_config(args)
    n, since = cfg["results_per_query"], cfg.get("since")
    exclude = [str(t) for t in cfg.get("exclude_types") or []]
    queries, dropped = sources.plan_queries(args.query, cfg.get("max_queries"))
    for q, reason in dropped:
        warn(f"query dropped: {q} ({reason})")
    parsed = [sources.query_terms(q) for q in queries]
    cache = QueryCache(args.query_cache, n, since, exclude) if args.query_cache else None
    log(f"OpenAlex: {'API key' if sources.OPENALEX_KEY else 'no API key'}; {len(queries)} queries"
        + (f", {len(dropped)} dropped" if dropped else ""))

    # 1-2. Retrieval. Relevance = rank within each query's OpenAlex results (100 = first).
    papers, arxiv_entries = [], []
    n_cached = 0
    with stage("search"):
        for i, q in enumerate(queries, 1):
            works, hit = cached_search(cache, "openalex", q, lambda: sources.openalex_search(q, n, since, exclude))
            n_cached += hit
            log(f"OpenAlex: {q}" + (" (cached)" if hit else ""))
            for rank, w in enumerate(works, 1):
                p = paper_from_openalex(w, venues)
                p["queries"].add(q)
                p["relevance"] = round(100 * (len(works) - rank + 1) / len(works), 1)
                p["relevance_note"] = f"#{rank}/{len(works)} for {q}"
                papers.append(p)
            try:
                entries, hit = cached_search(cache, "arxiv", q, lambda: sources.arxiv_search(q, n, since))
                log(f"arXiv:    {q}" + (" (cached)" if hit else ""))
                for e in entries:
                    arxiv_entries.append({**e, "query": q})
            except Exception as ex:
                warn(f"arXiv search failed for {q!r}: {ex}")
            counter("search", i, len(queries), f"queries ({len(papers)} OpenAlex, "
                    f"{len(arxiv_entries)} arXiv records" + (f", {n_cached} from cache" if n_cached else "") + ")")

    # Resolve arXiv hits in OpenAlex (published DOI first, else the arXiv DOI)
    with stage("resolve"):
        lookup = {}
        for e in arxiv_entries:
            lookup[e["arxiv_id"]] = sources.bare_doi(e["doi"]) or f"10.48550/arxiv.{e['arxiv_id'].lower()}"
        log(f"OpenAlex: resolving {len(lookup)} arXiv hits")
        found = sources.openalex_by_doi(list(lookup.values())) if lookup else {}
        for e in arxiv_entries:
            w = found.get(lookup[e["arxiv_id"]])
            p = paper_from_openalex(w, venues) if w else paper_from_arxiv(e)
            p["arxiv_id"] = p["arxiv_id"] or e["arxiv_id"]
            p["sources"].add("arXiv")
            if not p["abstract"] and e["abstract"]:
                p["abstract"], p["abstract_source"] = e["abstract"], "arXiv"
            p["queries"].add(e["query"])
            papers.append(p)
        counter("resolve", len(found), len(lookup), "arXiv hits found in OpenAlex")
    retrieved = len(papers)

    # 3. Deduplicate, filter, gate
    with stage("filter"):
        papers = deduplicate(papers)
        deduped = len(papers)
        papers, excluded, gated_out = filter_pool(papers, cfg, parsed, exclude)
        log(f"Candidates: {retrieved} retrieved, {deduped} after dedup, {excluded} excluded by type/year, "
            f"{gated_out} failed the relevance gate, {len(papers)} kept")
        counter("filter", len(papers), deduped, "candidates kept")

    # 4-5. Enrich and score
    s2_hits = enrich(papers, cfg)
    with stage("score"):
        score_all(papers, cfg, listed_inst)
    external_lookups(papers, venues, cfg, listed_inst, ("dblp", "openreview"))
    verify_cache = {}
    with stage("verify"):
        log("Verifying DOIs")
        main_list, preprints, grey, rejected = select_sections(papers, cfg, verify_cache)

    # Snowballing from the most relevant main-list papers
    snow = {"seeds": [], "fetched": 0, "kept": 0}
    n_seeds = cfg["snowball"]["seeds"]
    seeds = sorted([p for p in main_list if p["openalex_id"]],
                   key=lambda p: (p["relevance"], p["score"]), reverse=True)[:n_seeds]
    if seeds:
        with stage("snowball"):
            known = {p["openalex_id"] for p in papers}
            new = snowball(seeds, known, venues, cfg)
            new_unique = [p for p in deduplicate(new)]
            new_kept, _, _ = filter_pool(new_unique, cfg, parsed, exclude)
            before = {id(p) for p in papers}
            papers = deduplicate(papers + new_kept)
            added = [p for p in papers if id(p) not in before]
            snow = {"seeds": [s["title"] for s in seeds], "fetched": len(new_unique), "kept": len(added)}
            log(f"Snowballing: {len(new_unique)} new works, {len(new_kept)} passed the gate, "
                f"{len(added)} new after dedup")
        s2_hits += enrich(papers, cfg, stages=("snowball_authors", "snowball_orcid", "snowball_s2"))
        score_all(papers, cfg, listed_inst)
        external_lookups(papers, venues, cfg, listed_inst, ("snowball_dblp", "snowball_openreview"))
        with stage("snowball_verify"):
            score_all(papers, cfg, listed_inst)
            log("Verifying DOIs (after snowballing)")
            main_list, preprints, grey, rejected = select_sections(
                papers, cfg, verify_cache, sid="snowball_verify")
    else:
        for sid in ("snowball", "snowball_authors", "snowball_orcid", "snowball_s2", "snowball_dblp",
                    "snowball_openreview", "snowball_verify"):
            emit("stage", stage=sid, status="skipped")

    with stage("write"):
        for sec, rows in (("main", main_list), ("preprint", preprints), ("grey", grey)):
            for i, p in enumerate(rows, 1):
                p["section"], p["rank"] = sec, i
        for p in rejected:
            p["section"], p["rank"] = "rejected", ""

        # 8. Summaries
        for p in main_list + preprints + grey + rejected:
            render.summarise(p)

        meta = {
            "topic": args.topic, "queries": queries, "dropped_queries": dropped, "since": since,
            "date": datetime.date.today().isoformat(), "cfg": cfg,
            "retrieved": retrieved, "deduped": deduped, "gated_out": gated_out,
            "candidates": len(papers), "snowball": snow,
            "contact_email": bool(net.CONTACT_EMAIL), "openalex_key": bool(sources.OPENALEX_KEY),
            "s2_hits": s2_hits,
        }
        os.makedirs(args.out, exist_ok=True)
        render.write_all(args.out, main_list, preprints, grey, rejected, meta)
    log(f"Done: {len(main_list)} papers, {len(preprints)} preprints, {len(grey)} grey, "
        f"{len(rejected)} rejected; {net.stats['requests']} requests ({net.stats['retries']} retries)")
    emit("done", out=os.path.abspath(args.out), counts={
        "main": len(main_list), "preprint": len(preprints), "grey": len(grey), "rejected": len(rejected),
        "candidates": len(papers), "requests": net.stats["requests"]})
    with contextlib.redirect_stdout(sys.stderr) if PROGRESS else contextlib.nullcontext():
        render.print_console(main_list, preprints, grey, rejected)


if __name__ == "__main__":
    main()
