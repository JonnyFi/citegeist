"""Optional sources, each switchable in config.yaml (sources: ...):

  DBLP        venue and track (main / workshop / journal / informal) for CS papers, via the
              SPARQL endpoint (the REST API sits behind a browser challenge)
  OpenReview  review status (accepted / rejected / under review / withdrawn) and venue by title
  Unpaywall   open-access PDF locations for a DOI (needs OPENDRAFT_CONTACT_EMAIL)
  ORCID       confirms that split OpenAlex author profiles belong to one person, so their
              h-index can be computed over the merged works

All lookups are cached in settings.CACHE_DIR for 30 days.
"""

import functools
import json
import os
import re
import time
import unicodedata
import urllib.error
import urllib.parse

import net
import settings
import sources

TTL = 30 * 86400
CACHE_DIR = settings.CACHE_DIR


class Cache:
    """A JSON file of {key: {"t": fetched, "v": value}} with a 30-day TTL."""

    def __init__(self, name):
        self.path = os.path.join(CACHE_DIR, f"{name}.json")
        try:
            with open(self.path, encoding="utf-8") as f:
                self.data = json.load(f)
        except (OSError, json.JSONDecodeError):
            self.data = {}

    def get(self, key):
        e = self.data.get(key)
        return e["v"] if e and time.time() - e["t"] < TTL else KeyError

    def put(self, key, value):
        self.data[key] = {"t": time.time(), "v": value}

    def save(self):
        os.makedirs(CACHE_DIR, exist_ok=True)
        tmp = self.path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(self.data, f, ensure_ascii=False)
        os.replace(tmp, self.path)


def norm_title(t):
    t = unicodedata.normalize("NFKD", t or "").encode("ascii", "ignore").decode()
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", " ", t.lower())).strip()


def titles_match(a, b):
    """Equal after normalising, or equal once a short label ("Position: ...") is dropped from one."""
    drop = lambda t: re.sub(r"^\s*[\w\- ]{1,25}:\s+", "", t or "", count=1)  # noqa: E731
    na, nb = norm_title(a), norm_title(b)
    pairs = [(na, nb), (norm_title(drop(a)), nb), (na, norm_title(drop(b)))]  # drop the label from one side only
    return any(x == y and len(x) > 15 for x, y in pairs)


# --- DBLP (SPARQL) ------------------------------------------------------------------------------

DBLP_SPARQL = "https://sparql.dblp.org/sparql"
DBLP_QUERY = """PREFIX dblp: <https://dblp.org/rdf/schema#>
SELECT ?key ?p ?title ?venue ?year ?doi ?type ?proc ?stream WHERE {
  VALUES ?key { %s }
  %s
  ?p dblp:title ?title .
  OPTIONAL { ?p dblp:publishedIn ?venue }
  OPTIONAL { ?p dblp:yearOfPublication ?year }
  OPTIONAL { ?p dblp:doi ?doi }
  OPTIONAL { ?p a ?type . FILTER(?type != dblp:Publication) }
  OPTIONAL { ?p dblp:publishedAsPartOf ?pp . ?pp dblp:title ?proc }
  OPTIONAL { ?p dblp:publishedInStream ?stream }
}"""


def _sparql(query):
    data = net.fetch(DBLP_SPARQL, {"query": query}, headers={"Accept": "application/sparql-results+json"})
    return [{k: v["value"] for k, v in b.items()} for b in data["results"]["bindings"]]


def _lit(s):
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"'


def dblp_track(rec):
    kind = rec.get("type", "").rsplit("#", 1)[-1]
    text = " ".join([rec.get("venue", ""), rec.get("proc", ""), rec.get("stream", "")]).lower()
    if kind == "Informal" or rec.get("venue") == "CoRR":
        return "informal"
    if kind == "Article":
        return "journal"
    if re.search(r"\(findings\)|^findings of|\bfindings of the\b", text):
        return "findings"  # e.g. "Findings of ACL": its own proceedings, not the main conference
    if re.search(r"workshop|workshops|/w\b|-w\b|\bws\b", text):
        return "workshop"
    return "main" if kind == "Inproceedings" else kind.lower() or "other"


def _collect(rows):
    out = {}
    for r in rows:
        e = out.setdefault(r["p"], {"key_used": r["key"], "rec": r["p"], "title": r.get("title", ""),
                                    "venue": r.get("venue", ""), "year": r.get("year"), "doi": "",
                                    "type": "", "proc": "", "stream": ""})
        for k in ("doi", "type", "proc", "stream"):
            if r.get(k) and not e[k]:
                e[k] = r[k]
    for e in out.values():
        e["doi"] = sources.bare_doi(e["doi"])
        e["track"] = dblp_track(e)
    return list(out.values())


def dblp_lookup(papers, progress=None, batch=20):
    """{id(paper): [dblp records]} by exact DOI and exact title (DBLP stores titles with a final period)."""
    cache = Cache("dblp")
    todo, result = [], {}
    for p in papers:
        key = (p.get("doi") or "").lower() or norm_title(p.get("title"))
        hit = cache.get(key)
        if hit is KeyError:
            todo.append((p, key))
        else:
            result[id(p)] = hit
    for i in range(0, len(todo), batch):
        chunk = todo[i:i + batch]
        found = {id(p): [] for p, _ in chunk}
        by_doi = {f"https://doi.org/{p['doi'].upper()}": p for p, _ in chunk
                  if p.get("doi") and re.fullmatch(r"[A-Za-z0-9./_;:()\-]+", p["doi"])}
        by_title = {}
        for p, _ in chunk:
            t = (p.get("title") or "").strip().rstrip(".")
            if len(t) > 15:
                by_title[t + "."] = by_title[t] = p
        queries = []
        if by_doi:
            queries.append((by_doi, DBLP_QUERY % (" ".join(f"<{k}>" for k in by_doi), "?p dblp:doi ?key .")))
        if by_title:
            queries.append((by_title, DBLP_QUERY % (" ".join(_lit(k) for k in by_title), "?p dblp:title ?key .")))
        for index, query in queries:
            for rec in _collect(_sparql(query)):
                p = index.get(rec["key_used"])
                if p is not None and rec["rec"] not in {r["rec"] for r in found[id(p)]}:
                    found[id(p)].append(rec)
        for p, key in chunk:
            cache.put(key, found[id(p)])
            result[id(p)] = found[id(p)]
        if progress:
            progress(min(i + batch, len(todo)), len(todo))
    cache.save()
    return result


# --- OpenReview --------------------------------------------------------------------------------

OPENREVIEW_API2, OPENREVIEW_API1 = "https://api2.openreview.net", "https://api.openreview.net"
V1_STATE = {"available": True}  # api v1 answers HTTP 429 with ~40 s Retry-After; after one, skip it


def _or_value(content, key):
    v = content.get(key)
    return v.get("value") if isinstance(v, dict) else v


def review_status(venue, venueid):
    vid, v = (venueid or ""), (venue or "")
    if "withdrawn" in vid.lower() or "withdrawn" in v.lower():
        return "withdrawn"
    if re.search(r"(desk_)?rejected", vid, re.I) or re.search(r"\breject", v, re.I):
        return "rejected"
    if vid.endswith("/Submission") or v.lower().startswith("submitted to") or "under review" in v.lower():
        return "under review"
    if vid and v:
        return "accepted"
    return None


def openreview_lookup(title, cache, year=None):
    """Best OpenReview match for a title: {status, venue, venueid, forum} or None. Imported DBLP notes are skipped.

    api2 hosts venues since 2023 and many older ones; api v1 (older venues) is only asked for
    papers up to 2022, without retries, and not again in this process after an HTTP 429.
    """
    key = norm_title(title)
    hit = cache.get(key)
    if hit is not KeyError:
        return hit
    best, complete = None, True
    apis = [(OPENREVIEW_API2, net.MAX_RETRIES)]
    if not year or int(year) <= 2022:
        apis.append((OPENREVIEW_API1, 0))
    for api, retries in apis:
        if api == OPENREVIEW_API1 and not V1_STATE["available"]:
            complete = False
            continue
        try:
            data = net.fetch(f"{api}/notes/search", {"term": title, "type": "terms", "content": "all",
                                                     "source": "forum", "limit": 10}, retries=retries)
        except net.NotFound:
            continue
        except urllib.error.HTTPError as e:
            if api == OPENREVIEW_API1 and e.code == 429:
                V1_STATE["available"] = False
                complete = False
                continue
            raise
        for n in data.get("notes") or []:
            c = n.get("content") or {}
            venueid = _or_value(c, "venueid") or ""
            # DBLP imports and the public article archive are listings, not reviews
            if venueid.lower().startswith("dblp.org") or "public_article" in venueid.lower() \
                    or not titles_match(_or_value(c, "title") or "", title):
                continue
            venue = _or_value(c, "venue") or ""
            status = review_status(venue, venueid)
            if not status:
                continue
            cand = {"status": status, "venue": venue, "venueid": venueid,
                    "forum": f"https://openreview.net/forum?id={n.get('forum') or n.get('id')}"}
            main = status == "accepted" and "/workshop" not in venueid.lower() and "workshop" not in venue.lower()
            rank = 0 if main else ["accepted", "under review", "rejected", "withdrawn"].index(status) + 1
            if best is None or rank < best[0]:
                best = (rank, cand)
        if best:
            break
    value = best[1] if best else None
    if value or complete:  # don't cache a miss that skipped api v1
        cache.put(key, value)
    return value


# --- Unpaywall ---------------------------------------------------------------------------------

def unpaywall_pdfs(doi):
    """PDF URLs for a DOI from Unpaywall (best location first); [] without a contact email."""
    if not net.CONTACT_EMAIL or not doi:
        return []
    try:
        data = net.fetch(f"https://api.unpaywall.org/v2/{urllib.parse.quote(doi, safe='/')}",
                         {"email": net.CONTACT_EMAIL})
    except net.NotFound:
        return []
    locs = [data.get("best_oa_location") or {}] + (data.get("oa_locations") or [])
    urls = [l.get("url_for_pdf") for l in locs] + [l.get("url") for l in locs if (l.get("url") or "").endswith(".pdf")]
    return [u for u in dict.fromkeys(urls) if u]


# --- ORCID: merge split OpenAlex author profiles --------------------------------------------------

AUTHOR_SELECT = "id,display_name,orcid,summary_stats,affiliations,last_known_institutions"


def fold_name(name):
    s = unicodedata.normalize("NFKD", name or "").lower()
    s = s.replace("̈", "e")  # ü -> ue before the accent is dropped, so "Jürgen" == "Juergen"
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    return re.findall(r"[a-z]+", s)


def names_compatible(a, b):
    """Same family name and a compatible first name (equal, or an initial of it)."""
    ta, tb = fold_name(a), fold_name(b)
    if len(ta) < 2 or len(tb) < 2 or ta[-1] != tb[-1]:
        return False
    fa, fb = ta[0], tb[0]
    return fa == fb or (len(fa) == 1 and fb.startswith(fa)) or (len(fb) == 1 and fa.startswith(fb))


def profile(a):
    insts = [x.get("institution") or {} for x in a.get("affiliations") or []] + list(a.get("last_known_institutions") or [])
    return {"id": sources.short_id(a["id"]), "name": a.get("display_name") or "",
            "orcid": (a.get("orcid") or "").rsplit("/", 1)[-1] or None,
            "h_index": (a.get("summary_stats") or {}).get("h_index"),
            "inst_ids": sorted({sources.short_id(i["id"]) for i in insts if i.get("id")}),
            "inst_names": sorted({i["display_name"] for i in insts if i.get("display_name")})}


def _org(s):
    return " ".join(fold_name(s))


def orcid_record(orcid, cache):
    hit = cache.get(orcid)
    if hit is not KeyError:
        return hit
    out = _fetch_orcid(orcid)
    cache.put(orcid, out)
    return out


def _fetch_orcid(orcid):
    """Names, affiliations and work DOIs from the public ORCID record (None if it does not exist)."""
    try:
        rec = net.fetch(f"https://pub.orcid.org/v3.0/{orcid}/record", headers={"Accept": "application/json"})
    except net.NotFound:
        return None
    person = rec.get("person") or {}
    nm = person.get("name") or {}
    val = lambda x: (x or {}).get("value") or ""  # noqa: E731
    names = [f"{val(nm.get('given-names'))} {val(nm.get('family-name'))}".strip(), val(nm.get("credit-name"))]
    names += [o.get("content") or "" for o in (person.get("other-names") or {}).get("other-name") or []]
    acts = rec.get("activities-summary") or {}
    orgs = []
    for section, kind in (("employments", "employment-summary"), ("educations", "education-summary")):
        for g in (acts.get(section) or {}).get("affiliation-group") or []:
            for s in g.get("summaries") or []:
                orgs.append(((s.get(kind) or {}).get("organization") or {}).get("name") or "")
    dois = []
    for g in (acts.get("works") or {}).get("group") or []:
        for e in (g.get("external-ids") or {}).get("external-id") or []:
            if e.get("external-id-type") == "doi":
                dois.append(sources.bare_doi(e.get("external-id-value")))
    return {"names": [n for n in names if n], "orgs": sorted({o for o in orgs if o}), "dois": sorted(set(dois))}


@functools.lru_cache(maxsize=4096)
def _author_dois(aid):
    data = net.fetch(f"{sources.OPENALEX}/works", sources._oa({"filter": f"author.id:{aid}", "select": "doi", "per-page": 200}))
    return {sources.bare_doi(w.get("doi")) for w in data.get("results") or [] if w.get("doi")}


def initial_match(a, b):
    """True when the names only match through an initial (e.g. "J. Schmidhuber" / "Jürgen Schmidhuber")."""
    ta, tb = fold_name(a), fold_name(b)
    return len(ta[0]) == 1 or len(tb[0]) == 1 if ta and tb else True


def confirm(frag, anchor, rec, ambiguous=False):
    """Evidence from the anchor's ORCID record that `frag` (no ORCID) is the same person:
    a work DOI the record lists, or an institution it lists as employment or education.
    Names that only match through an initial, and names shared by many OpenAlex profiles
    (ambiguous=True), need the DOI."""
    if frag.get("orcid"):
        return "same ORCID" if frag["orcid"] == anchor["orcid"] else None
    matching = [n for n in [anchor["name"]] + rec["names"] if names_compatible(frag["name"], n)]
    if not matching:
        return None
    strict = ambiguous or all(initial_match(frag["name"], n) for n in matching)
    if not strict:
        orgs = {_org(o) for o in rec["orgs"]}
        shared = orgs & {_org(n) for n in frag["inst_names"]}
        if shared:
            return f"institution in the ORCID record ({sorted(shared)[0].title()})"
    if rec["dois"] and _author_dois(frag["id"]) & set(rec["dois"]):
        return "work listed in the ORCID record"
    return None


def merged_h(members):
    """h-index over the union of the profiles' works (deduplicated by work id).

    Only works cited at least as often as the best single profile's h-index can count towards a
    merged h at or above it, so one filtered request per 200 of those works is enough.
    """
    ids = [m["id"] for m in members]
    floor = max((m["h_index"] or 0) for m in members)
    cites, cursor = {}, "*"
    while cursor:
        data = net.fetch(f"{sources.OPENALEX}/works", sources._oa({
            "filter": f"author.id:{'|'.join(ids)},cited_by_count:>{max(floor - 1, 0)}",
            "select": "id,cited_by_count", "per-page": 200, "cursor": cursor}))
        for w in data.get("results") or []:
            cites[w["id"]] = w.get("cited_by_count") or 0
        cursor = (data.get("meta") or {}).get("next_cursor") if len(data.get("results") or []) == 200 else None
    counts = sorted(cites.values(), reverse=True)
    return max(floor, sum(1 for i, c in enumerate(counts, 1) if c >= i)), len(counts)


def _parallel(fn, items, workers=4):
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(workers) as ex:
        return list(ex.map(fn, items))


def orcid_merge(author_profiles, progress=None):
    """{author id: merge info} for authors whose split OpenAlex profiles an ORCID record ties together.

    author_profiles: {id: profile()} for the authors to check. For each author, OpenAlex is
    searched for profiles with a compatible name. The ORCID holder that is this author (the author
    itself, or the first of the five most-cited same-name holders that confirm() ties to it) is
    the anchor; other same-name profiles without an ORCID merge into it only with confirm()
    evidence. Holders of other ORCIDs are different people and are never compared with each other.
    One merged h-index per anchor, so every paper by that person gets the same value.
    Network phases (name searches, ORCID records, merged h) run in 4 threads under net's rate limit.
    """
    search_cache, orcid_cache = Cache("author_search"), Cache("orcid")
    confirm_cache, h_cache = Cache("orcid_confirm"), Cache("orcid_h")
    items = [a for a in author_profiles.values() if len(fold_name(a["name"])) >= 2]
    total = len(items) + 3
    step = lambda n: progress and progress(n, total)  # noqa: E731
    try:
        # phase 1: one OpenAlex name search per distinct name
        keys = sorted({" ".join(fold_name(a["name"])) for a in items})
        names = {" ".join(fold_name(a["name"])): a["name"] for a in items}
        missing = [k for k in keys if search_cache.get(k) is KeyError]

        def search(k):
            data = net.fetch(f"{sources.OPENALEX}/authors", sources._oa({"search": names[k], "per-page": 25, "select": AUTHOR_SELECT}))
            return k, [profile(x) for x in data.get("results") or []]
        for k, hits in _parallel(search, missing):
            search_cache.put(k, hits)
        step(1)
        groups = {}
        for a in items:
            k = " ".join(fold_name(a["name"]))
            g = {h["id"]: h for h in search_cache.get(k) if names_compatible(h["name"], a["name"])}
            g[a["id"]] = a
            groups[a["id"]] = g

        # phase 2: ORCID records of every holder that could be one of these authors
        def holders(a):
            if a.get("orcid"):
                return [a]
            return sorted([g for g in groups[a["id"]].values() if g.get("orcid")], key=lambda g: -(g["h_index"] or 0))[:5]
        need = sorted({h["orcid"] for a in items for h in holders(a)} - {o for o in orcid_cache.data if orcid_cache.get(o) is not KeyError})
        for o, rec in _parallel(lambda o: (o, _fetch_orcid(o)), need):
            orcid_cache.put(o, rec)
        step(2)

        def confirmed(g, anchor, rec, ambiguous):
            ck = f"v2|{anchor['id']}|{g['id']}|{int(ambiguous)}"
            why = confirm_cache.get(ck)
            if why is KeyError:
                why = confirm(g, anchor, rec, ambiguous)
                confirm_cache.put(ck, why)
            return why

        # phase 3: confirmations (free unless a DOI check is needed)
        anchors, members = {}, {}
        for n, a in enumerate(items, 1):
            ambiguous = len(groups[a["id"]]) >= 5  # many same-name profiles: likely several people
            cands = []
            for h in holders(a):
                rec = orcid_cache.get(h["orcid"])
                if not rec or rec is KeyError:
                    continue
                if h["id"] == a["id"] or confirmed(a, h, rec, ambiguous):
                    cands.append((h, rec))
                    break
            for anchor, rec in cands:
                anchors[anchor["id"]] = anchor
                ms = members.setdefault(anchor["id"], {})
                if anchor["id"] != a["id"]:
                    ms[a["id"]] = (a, confirmed(a, anchor, rec, ambiguous))
                for g in groups[a["id"]].values():  # other same-name fragments of this person
                    if g["id"] == anchor["id"] or g["id"] in ms or g.get("orcid"):
                        continue
                    why = confirmed(g, anchor, rec, ambiguous)
                    if why:
                        ms[g["id"]] = (g, why)
            if progress and n % 10 == 0:
                progress(2 + n, total)

        # phase 4: one merged h-index per person
        todo = [(aid, [anchors[aid]] + [m for m, _ in ms.values()]) for aid, ms in members.items() if ms]
        keyed = {aid: "v2|" + "|".join(sorted(m["id"] for m in group)) for aid, group in todo}
        for hk, hv in _parallel(lambda t: (keyed[t[0]], merged_h(t[1])),
                                [t for t in todo if h_cache.get(keyed[t[0]]) is KeyError]):
            h_cache.put(hk, hv)
        out = {}
        for aid, group in todo:
            h, n_works = h_cache.get(keyed[aid])
            ms = members[aid]
            info = {"orcid": anchors[aid]["orcid"], "h": h, "works_counted": n_works,
                    "members": [{"id": m["id"], "name": m["name"], "h": m["h_index"],
                                 "evidence": "ORCID holder" if m["id"] == aid else ms[m["id"]][1]} for m in group]}
            for m in group:
                if m["id"] not in out or info["h"] > out[m["id"]]["h"]:
                    out[m["id"]] = info
        step(total)
        return out
    finally:
        for c in (search_cache, orcid_cache, confirm_cache, h_cache):
            c.save()
