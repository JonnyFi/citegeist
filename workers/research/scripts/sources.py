"""API clients: OpenAlex, arXiv, Semantic Scholar, Crossref, DataCite."""

import json
import os
import re
import sys
import time
import urllib.parse
import xml.etree.ElementTree as ET

from net import NotFound, fetch, with_mailto

OPENALEX = "https://api.openalex.org"
OPENALEX_KEY = os.environ.get("OPENALEX_API_KEY", "").strip()  # optional; keyless if unset
WORK_FIELDS = ",".join([
    "id", "doi", "title", "publication_year", "publication_date", "type",
    "cited_by_count", "fwci", "abstract_inverted_index", "authorships",
    "primary_location", "locations", "biblio", "ids", "referenced_works",
])
AUTHOR_TTL_DAYS = 30
STOPWORDS = {
    "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "in", "into",
    "is", "of", "on", "or", "the", "to", "via", "with", "without",
}


def log(msg):  # replaced by pipeline.py to emit progress events
    print(msg, file=sys.stderr)


def warn(msg):
    print(f"  [warn] {msg}", file=sys.stderr)


def _chunks(seq, n):
    for i in range(0, len(seq), n):
        yield seq[i:i + n]


# --- OpenAlex ---------------------------------------------------------------

def _oa(params):
    """OpenAlex parameters: mailto, plus api_key when OPENALEX_API_KEY is set."""
    params = with_mailto(params)
    if OPENALEX_KEY:
        params["api_key"] = OPENALEX_KEY
    return params


def query_terms(query):
    """Split a query into (quoted phrases, other words), lowercase, stopwords dropped.

    Hyphenated words count as phrases ("self-improvement" -> "self improvement").
    """
    phrases, words = [], []
    for phrase, tok in re.findall(r'"([^"]+)"|([\w\-]+)', query.lower()):
        if phrase:
            phrases.append(" ".join(re.findall(r"\w+", phrase)))
        elif "-" in tok:
            phrases.append(" ".join(re.findall(r"\w+", tok)))
        elif tok not in STOPWORDS:
            words.append(tok)
    return [p for p in phrases if p], words


def _singular(word):
    if len(word) > 4 and word.endswith("ies"):
        return word[:-3] + "y"
    if len(word) > 4 and word.endswith("sses"):
        return word[:-2]
    if len(word) > 3 and word.endswith("s") and not word.endswith(("ss", "us", "is")):
        return word[:-1]
    return word


def query_key(query):
    """Case- and plural-insensitive form of a query, keeping quotes and word order."""
    q = " ".join(query.lower().split())
    return re.sub(r"\w+", lambda m: _singular(m.group(0)), q)


def plan_queries(queries, cap=None):
    """Drop queries that only differ by plural or case from an earlier one, then cap the list.

    Returns (kept, dropped) where dropped is a list of (query, reason).
    """
    kept, dropped, seen = [], [], {}
    for q in (" ".join(q.split()) for q in queries):
        if not q:
            continue
        k = query_key(q)
        if k in seen:
            dropped.append((q, f"plural/case variant of {seen[k]}"))
        elif cap and len(kept) >= cap:
            dropped.append((q, f"over the limit of {cap} queries"))
        else:
            seen[k] = q
            kept.append(q)
    return kept, dropped


def openalex_search(query, n, since=None, exclude_types=()):
    q = query.replace(",", " ").replace("|", " ")
    filters = [f"title_and_abstract.search:{q}"] + [f"type:!{t}" for t in exclude_types]
    if since:
        filters.append(f"from_publication_date:{since}-01-01")
    works, page = [], 1
    while len(works) < n:
        per_page = min(200, n)
        data = fetch(f"{OPENALEX}/works", _oa({
            "filter": ",".join(filters), "per_page": per_page, "page": page,
            "sort": "relevance_score:desc", "select": WORK_FIELDS,
        }))
        results = data.get("results") or []
        works.extend(results)
        if len(results) < per_page:
            break
        page += 1
    return works[:n]


def openalex_by_doi(dois):
    """Look up works by DOI (bare DOIs). Returns {lowercase doi: work}."""
    found = {}
    for chunk in _chunks(sorted(set(dois)), 50):
        data = fetch(f"{OPENALEX}/works", _oa({
            "filter": "doi:" + "|".join(chunk), "per_page": 50, "select": WORK_FIELDS,
        }))
        for w in data.get("results") or []:
            if w.get("doi"):
                found[bare_doi(w["doi"])] = w
    return found


def openalex_by_ids(work_ids):
    """Fetch works by OpenAlex ID (short form, e.g. W123)."""
    works = []
    for chunk in _chunks(sorted(set(work_ids)), 50):
        data = fetch(f"{OPENALEX}/works", _oa({
            "filter": "openalex:" + "|".join(chunk), "per_page": 50, "select": WORK_FIELDS,
        }))
        works.extend(data.get("results") or [])
    return works


def openalex_citing(work_id, n):
    """Works citing `work_id`, most cited first."""
    data = fetch(f"{OPENALEX}/works", _oa({
        "filter": f"cites:{work_id}", "per_page": min(200, n),
        "sort": "cited_by_count:desc", "select": WORK_FIELDS,
    }))
    return (data.get("results") or [])[:n]


def openalex_authors(author_ids, cache_dir, progress=None):
    """Return {short author id: {"name", "h_index"}}, using a JSON file cache."""
    os.makedirs(cache_dir, exist_ok=True)
    path = os.path.join(cache_dir, "authors.json")
    try:
        with open(path, encoding="utf-8") as f:
            cache = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        cache = {}
    now = time.time()
    # entries without "orcid" predate the ORCID merge and are fetched again once
    fresh = lambda e: now - e.get("fetched", 0) < AUTHOR_TTL_DAYS * 86400 and "orcid" in e
    missing = [a for a in set(author_ids) if a not in cache or not fresh(cache[a])]
    log(f"  authors: {len(set(author_ids)) - len(missing)} cached, {len(missing)} to fetch")
    done = 0
    if progress:
        progress(0, len(missing))
    try:
        for chunk in _chunks(sorted(missing), 50):
            data = fetch(f"{OPENALEX}/authors", _oa({
                "filter": "id:" + "|".join(chunk), "per_page": 50,
                "select": "id,display_name,summary_stats,orcid,affiliations,last_known_institutions",
            }))
            for a in data.get("results") or []:
                stats = a.get("summary_stats") or {}
                insts = [x.get("institution") or {} for x in a.get("affiliations") or []] + \
                    list(a.get("last_known_institutions") or [])
                cache[short_id(a["id"])] = {
                    "name": a.get("display_name"), "h_index": stats.get("h_index"),
                    "orcid": (a.get("orcid") or "").rsplit("/", 1)[-1] or None,
                    "inst_ids": sorted({short_id(i["id"]) for i in insts if i.get("id")}),
                    "inst_names": sorted({i["display_name"] for i in insts if i.get("display_name")}),
                    "fetched": now,
                }
            done += len(chunk)
            if progress:
                progress(done, len(missing))
    finally:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(cache, f)
    return {a: cache[a] for a in author_ids if a in cache}


def reconstruct_abstract(inverted):
    if not inverted:
        return ""
    positions = [(pos, word) for word, poss in inverted.items() for pos in poss]
    return " ".join(word for _, word in sorted(positions))


def short_id(url):
    return url.rsplit("/", 1)[-1] if url else url


def bare_doi(doi):
    if not doi:
        return ""
    doi = doi.strip().lower()
    return re.sub(r"^(https?://(dx\.)?doi\.org/|doi:)", "", doi)


# --- arXiv -------------------------------------------------------------------

ATOM = "{http://www.w3.org/2005/Atom}"
ARXIV_NS = "{http://arxiv.org/schemas/atom}"


def _arxiv_query(query, since):
    phrases, words = query_terms(query)
    q = " AND ".join([f'all:"{p}"' for p in phrases] + [f"all:{w}" for w in words])
    if since:
        q = f"({q}) AND submittedDate:[{since}01010000 TO 299912312359]"
    return q


def arxiv_search(query, n, since=None):
    text = fetch("https://export.arxiv.org/api/query", {
        "search_query": _arxiv_query(query, since), "start": 0, "max_results": n,
        "sortBy": "submittedDate", "sortOrder": "descending",
    }, as_json=False)
    root = ET.fromstring(text)
    entries = []
    for e in root.findall(f"{ATOM}entry"):
        abs_url = (e.findtext(f"{ATOM}id") or "").strip()
        m = re.search(r"arxiv\.org/abs/(.+?)(v\d+)?$", abs_url)
        if not m:
            continue
        entries.append({
            "arxiv_id": m.group(1),
            "title": " ".join((e.findtext(f"{ATOM}title") or "").split()),
            "abstract": " ".join((e.findtext(f"{ATOM}summary") or "").split()),
            "authors": [" ".join((a.findtext(f"{ATOM}name") or "").split())
                        for a in e.findall(f"{ATOM}author")],
            "published": (e.findtext(f"{ATOM}published") or "")[:10],
            "doi": (e.findtext(f"{ARXIV_NS}doi") or "").strip(),
            "journal_ref": (e.findtext(f"{ARXIV_NS}journal_ref") or "").strip(),
        })
    return entries


def arxiv_id_from_work(work):
    """arXiv ID from an OpenAlex work's DOI or locations, if it has one."""
    m = re.match(r"10\.48550/arxiv\.(.+)$", bare_doi(work.get("doi")))
    if m:
        return m.group(1)
    for loc in work.get("locations") or []:
        for key in ("landing_page_url", "pdf_url"):
            m = re.search(r"arxiv\.org/(?:abs|pdf)/([^\s?#]+?)(v\d+)?(\.pdf)?$", loc.get(key) or "")
            if m:
                return m.group(1)
    return ""


# --- Semantic Scholar --------------------------------------------------------

def semantic_scholar(ids):
    """ids: list of 'DOI:...' / 'ARXIV:...'. Returns {id: record}; {} on failure.

    Records carry influentialCitationCount, tldr and authors (name, hIndex).
    """
    out = {}
    for chunk in _chunks(list(dict.fromkeys(ids)), 400):
        try:
            data = fetch(
                "https://api.semanticscholar.org/graph/v1/paper/batch",
                {"fields": "influentialCitationCount,tldr,authors.name,authors.hIndex"},
                data={"ids": chunk},
            )
        except Exception as e:  # keep going without S2 fields
            warn(f"Semantic Scholar unavailable ({e}); fields left empty")
            return out
        for key, rec in zip(chunk, data):
            if rec:
                out[key] = rec
    return out


# --- DOI verification ----------------------------------------------------------

def verify_doi(doi):
    """Return (verified_doi, registry) or (None, reason)."""
    doi = bare_doi(doi)
    quoted = urllib.parse.quote(doi, safe="/")
    registries = ["DataCite"] if doi.startswith("10.48550/") else ["Crossref", "DataCite"]
    for reg in registries:
        try:
            if reg == "Crossref":
                data = fetch(f"https://api.crossref.org/works/{quoted}", with_mailto({}))
                return bare_doi(data["message"]["DOI"]), reg
            data = fetch(f"https://api.datacite.org/dois/{quoted}")
            return bare_doi(data["data"]["attributes"]["doi"]), reg
        except NotFound:
            continue
        except Exception as e:
            return None, f"verification error at {reg}: {e}"
    return None, f"DOI not found at {' or '.join(registries)}"
