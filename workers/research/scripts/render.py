"""Summaries and output files: papers.md, summaries.md, papers.csv, references.bib."""

import csv
import html
import os
import re
import unicodedata

from score import FIELD_LABELS

PREPRINT_LABEL = "preprint (not peer-reviewed)"
GREY_LABEL = "grey literature"
SNOWBALL_LABEL = "found via snowballing"
CONTRIBUTION = re.compile(
    r"\b(we|this (paper|work|study|article|chapter)|our (paper|work|study))\b.{0,80}?\b("
    r"propose|present|introduce|show|find|develop|argue|demonstrate|examine|investigate|"
    r"study|explore|analy[sz]e|report|offer|describe|evaluate|provide)", re.I)
TITLE_STOPWORDS = {
    "a", "an", "and", "are", "as", "at", "by", "can", "do", "for", "from", "how", "in", "into",
    "is", "of", "on", "or", "the", "to", "towards", "toward", "via", "what", "when", "why", "with",
}


# --- summaries ------------------------------------------------------------------

def _clean(text):
    text = html.unescape(re.sub(r"<[^>]+>", " ", text or ""))
    text = re.sub(r"\s+", " ", text).strip()
    return re.sub(r"^(abstract|summary)[\s.:\-]+", "", text, flags=re.I)


def summarise(p):
    """1-2 sentences taken from the S2 TLDR or the abstract; never from the title."""
    if p.get("tldr"):
        p["summary"], p["summary_source"] = p["tldr"], "Semantic Scholar TLDR"
        return
    abstract = _clean(p.get("abstract"))
    if not abstract:
        p["summary"], p["summary_source"] = "no abstract available", ""
        return
    # also split "tasks.However" (OpenAlex abstracts sometimes lose the space after a full stop)
    sentences = [s for s in re.split(r"(?<=[.!?])\s+(?=[A-Z])|(?<=[a-z0-9)][.!?])(?=[A-Z][a-z])", abstract) if s]
    start = next((i for i, s in enumerate(sentences) if CONTRIBUTION.search(s)), 0)
    picked = sentences[start:start + 1]
    if len(picked[0].split()) < 30 and start + 1 < len(sentences):
        picked.append(sentences[start + 1])
    p["summary"] = " ".join(picked)
    p["summary_source"] = f"{p.get('abstract_source') or 'abstract'} abstract (extract)"


# --- helpers ----------------------------------------------------------------------

def _authors_short(p, n=3):
    a = p.get("authors") or []
    return ", ".join(a[:n]) + (" et al." if len(a) > n else "")


def via_snowball(p):
    return bool(p.get("snowball")) and not p.get("queries")


def _venue_cell(p):
    if p.get("is_grey"):
        return f"{p.get('venue') or 'unknown'}: {GREY_LABEL}"
    if p.get("is_preprint"):
        return f"{p.get('venue') or 'unknown'}: {PREPRINT_LABEL}"
    if p.get("venue_tier"):
        return f"{p['venue']} (tier {p['venue_tier']}, {FIELD_LABELS.get(p['venue_field'], p['venue_field'])})"
    if p.get("venue"):
        return f"{p['venue']} (unlisted)"
    return f"venue unknown (found in {p['found_in']})" if p.get("found_in") else "venue unknown"


def _cites_cell(p):
    parts = []
    if p.get("citations_per_year") is not None:
        parts.append(f"{p['citations_per_year']}")
    if p.get("fwci") is not None:
        parts.append(f"FWCI {p['fwci']:.2f}")
    return " · ".join(parts)


def _link(p):
    return f"https://doi.org/{p['verified_doi']}" if p.get("verified_doi") else ""


def _md(text):
    return str(text if text is not None else "").replace("|", "\\|").replace("\n", " ")


def _table(rows):
    head = ["Rank", "Score", "Title", "Authors", "Year", "Venue (tier)", "Cit./yr",
            "Max h", "Why selected", "Link"]
    out = ["| " + " | ".join(head) + " |", "|" + "---|" * len(head)]
    for p in rows:
        title = p["title"] + (f" _({SNOWBALL_LABEL})_" if via_snowball(p) else "")
        cells = [p["rank"], f"{p['score']:.1f}", title, _authors_short(p), p.get("year") or "",
                 _venue_cell(p), _cites_cell(p),
                 p["max_h_index"] if p.get("max_h_index") is not None else "",
                 p["why_selected"], f"[doi]({_link(p)})" if _link(p) else ""]
        out.append("| " + " | ".join(_md(c) for c in cells) + " |")
    return "\n".join(out)


# --- papers.md / summaries.md ---------------------------------------------------------

def write_papers_md(path, main, preprints, grey, rejected, meta):
    cfg, w, snow = meta["cfg"], meta["cfg"]["weights"], meta["snowball"]
    lines = [
        f"# Research Pipeline: {meta['topic']}", "",
        f"Generated {meta['date']} · {meta['retrieved']} records retrieved, {meta['deduped']} after "
        f"dedup, {meta['gated_out']} failed the relevance gate, {meta['candidates']} candidates ranked · "
        f"since: {meta['since'] or 'no limit'} · "
        f"weights relevance/venue/author/citations = "
        f"{w['relevance']}/{w['venue']}/{w['author']}/{w['citations']}", "",
        "Score (0–100) = relevance (rank within each query's OpenAlex results; best across queries) "
        "+ venue tier (DBLP wins where it disagrees with OpenAlex) + max author h-index (OpenAlex, "
        "with split profiles merged via ORCID, or Semantic Scholar, whichever is higher; log-scaled) + citation impact (FWCI if OpenAlex has it, else citations/year, log-scaled). "
        "“Why selected” lists the two largest contributions as points/maximum.", "",
        f"Snowballing: references and citing works of {len(snow['seeds'])} seed papers added "
        f"{snow['kept']} new candidates (marked “{SNOWBALL_LABEL}”; relevance fixed at "
        f"{cfg['unranked_relevance']}).", "",
        f"## Ranked papers ({len(main)})", "",
        _table(main) if main else "_None._", "",
        f"## Preprints: {PREPRINT_LABEL} ({len(preprints)})", "",
        _table(preprints) if preprints else "_None._", "",
        f"## Grey literature: hosted only on {', '.join(h.title() for h in cfg['grey_literature_hosts'][:3])} "
        f"and similar ({len(grey)})", "",
        _table(grey) if grey else "_None._", "",
        f"## Rejected ({len(rejected)})", "",
    ]
    if rejected:
        lines += [f"- {p['title']} ({p.get('year') or 'n.d.'}): {p['rejected_reason']}" for p in rejected]
    else:
        lines.append("_None._")
    listed = main + preprints + grey
    notes = [p for p in listed if p.get("venue_note")]
    if notes:
        lines += ["", f"## Venue notes from DBLP ({len(notes)})", ""]
        lines += [f"- {p['title']}: {p['venue_note']}" for p in notes]
    reviewed = [p for p in listed if p.get("openreview_status")]
    if reviewed:
        lines += ["", f"## Review status on OpenReview ({len(reviewed)})", ""]
        lines += [f"- {p['title']}: {p['openreview_status']}: {p['openreview_venue']} ({p['openreview_forum']})"
                  for p in reviewed]
    merged = [p for p in listed if p.get("h_index_note")]
    if merged:
        lines += ["", f"## Author h-index from merged profiles (ORCID) ({len(merged)})", ""]
        lines += [f"- {p['title']}: {p['h_index_note']}" for p in merged]
    lines += ["", "## Search queries used", ""]
    lines += [f"{i}. {q}" for i, q in enumerate(meta["queries"], 1)]
    if meta.get("dropped_queries"):
        lines += ["", "Dropped before searching:", ""]
        lines += [f"- {q} ({reason})" for q, reason in meta["dropped_queries"]]
    if snow["seeds"]:
        lines += ["", "## Snowballing seeds", ""] + [f"{i}. {t}" for i, t in enumerate(snow["seeds"], 1)]
    lines.append("")
    _write(path, "\n".join(lines))


def write_summaries_md(path, main, preprints, grey, meta):
    lines = [f"# Summaries: {meta['topic']}", "",
             "Summaries use only the Semantic Scholar TLDR or sentences from the abstract.", ""]
    for heading, rows in (("Ranked papers", main), (f"Preprints: {PREPRINT_LABEL}", preprints),
                          ("Grey literature", grey)):
        lines += [f"## {heading}", ""]
        for p in rows:
            lines += [
                f"### {p['rank']}. {p['title']}" + (f" ({SNOWBALL_LABEL})" if via_snowball(p) else ""),
                f"{_authors_short(p)} · {p.get('year') or 'n.d.'} · {_venue_cell(p)} · "
                f"score {p['score']:.1f}" + (f" · {_link(p)}" if _link(p) else ""), "",
                p["summary"] + (f"  \n_Source: {p['summary_source']}_" if p["summary_source"] else ""), "",
            ]
    _write(path, "\n".join(lines))


# --- papers.csv ---------------------------------------------------------------------------

CSV_FIELDS = [
    "section", "rank", "score", "score_relevance", "score_venue", "score_author", "score_citations",
    "why_selected", "relevance", "relevance_note", "found_via",
    "title", "authors", "year", "publication_date", "venue", "venue_type", "found_in", "venue_canonical",
    "venue_tier", "venue_field", "type", "is_preprint", "is_grey", "doi", "verified_doi", "verified_by",
    "doi_origin", "arxiv_id", "openalex_id", "cited_by_count", "citations_per_year", "fwci",
    "influential_citations", "max_h_index", "max_h_author", "max_h_source", "institutions", "listed_institutions",
    "volume", "issue", "pages", "abstract", "abstract_source", "tldr", "summary", "summary_source",
    "queries", "sources", "link", "rejected_reason",
    "venue_note", "dblp_venue", "dblp_track", "dblp_key", "openreview_status", "openreview_venue",
    "openreview_forum", "h_index_note",
]


def write_csv(path, rows):
    with open(path, "w", encoding="utf-8-sig", newline="") as f:  # BOM so Excel reads UTF-8
        wr = csv.DictWriter(f, fieldnames=CSV_FIELDS, extrasaction="ignore")
        wr.writeheader()
        for p in rows:
            r = dict(p)
            r["link"] = _link(p)
            r["found_via"] = f"snowballing ({p['snowball']})" if via_snowball(p) else "query"
            for k in ("authors", "institutions", "listed_institutions"):
                r[k] = "; ".join(p.get(k) or [])
            for k in ("queries", "sources"):
                r[k] = "; ".join(sorted(p.get(k) or []))
            r["abstract"] = _clean(p.get("abstract"))
            wr.writerow({k: ("" if r.get(k) is None else r.get(k)) for k in CSV_FIELDS})


# --- references.bib -------------------------------------------------------------------------

def _ascii(s):
    return unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode()


def _bib_escape(s):
    s = re.sub(r"\s+", " ", s or "").strip()
    return re.sub(r"([&%$#_])", r"\\\1", s)


def citation_key(p):
    last = re.sub(r"[^a-z]", "", _ascii((p.get("authors") or ["anon"])[0].split()[-1]).lower()) or "anon"
    words = [re.sub(r"[^a-z0-9]", "", _ascii(t).lower()) for t in (p.get("title") or "").split()]
    keyword = next((t for t in words if len(t) > 2 and t not in TITLE_STOPWORDS), "paper")
    return f"{last}{p.get('year') or 'nd'}{keyword}"


def write_bib(path, rows):
    used, entries = {}, []
    for p in rows:
        base = citation_key(p)
        n = used.get(base, 0)
        used[base] = n + 1
        key = base if n == 0 else base + "abcdefghijklmnopqrstuvwxyz"[min(n - 1, 25)]
        fields = [("title", "{" + _bib_escape(p["title"]) + "}"),
                  ("author", " and ".join(_bib_escape(a) for a in p.get("authors") or []))]
        if p.get("year"):
            fields.append(("year", str(p["year"])))
        if p.get("is_grey"):
            etype = "misc"
            if p.get("venue"):
                fields.append(("howpublished", _bib_escape(p["venue"])))
        elif p.get("is_preprint"):
            etype = "misc"
            if p.get("arxiv_id"):
                fields += [("eprint", p["arxiv_id"]), ("archiveprefix", "arXiv")]
            elif p.get("venue"):
                fields.append(("howpublished", _bib_escape(p["venue"])))
            fields.append(("note", "Preprint, not peer-reviewed"))
        elif p.get("venue_type") == "conference" or p.get("type") in ("conference-paper", "proceedings-article"):
            etype = "inproceedings"
            fields.append(("booktitle", _bib_escape(p["venue"])))
        elif p.get("type") == "book-chapter":
            etype = "incollection"
            fields.append(("booktitle", _bib_escape(p["venue"])))
        elif p.get("venue"):
            etype = "article"
            fields.append(("journal", _bib_escape(p["venue"])))
        else:
            etype = "misc"
        for k in ("volume", "issue", "pages"):
            if p.get(k):
                fields.append(("number" if k == "issue" else k, _bib_escape(str(p[k]).replace("-", "--"))))
        if p.get("arxiv_id") and not p.get("is_preprint"):
            fields.append(("eprint", p["arxiv_id"]))
            fields.append(("archiveprefix", "arXiv"))
        fields += [("doi", p["verified_doi"]), ("url", _link(p))]
        body = ",\n".join(f"  {k} = {{{v}}}" for k, v in fields if v)
        entries.append(f"@{etype}{{{key},\n{body}\n}}")
    _write(path, "\n\n".join(entries) + "\n")


# --- entry points ------------------------------------------------------------------------------

def _write(path, text):
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)


def write_all(out, main, preprints, grey, rejected, meta):
    write_papers_md(os.path.join(out, "papers.md"), main, preprints, grey, rejected, meta)
    write_summaries_md(os.path.join(out, "summaries.md"), main, preprints, grey, meta)
    write_csv(os.path.join(out, "papers.csv"), main + preprints + grey + rejected)
    write_bib(os.path.join(out, "references.bib"), main + preprints + grey)


def print_console(main, preprints, grey, rejected, top=15):
    def line(p):
        snow = f" [{SNOWBALL_LABEL}]" if via_snowball(p) else ""
        return (f"  {p['rank']:>2}. [{p['score']:5.1f}] {p['title'][:90]} ({p.get('year')}): "
                f"{_venue_cell(p)}{snow}\n       why: {p['why_selected']}")
    print(f"TOP {min(top, len(main))} of {len(main)} ranked papers:")
    print("\n".join(line(p) for p in main[:top]) or "  (none)")
    print(f"\nPREPRINTS ({len(preprints)}):")
    print("\n".join(line(p) for p in preprints) or "  (none)")
    print(f"\nGREY LITERATURE ({len(grey)}):")
    print("\n".join(line(p) for p in grey) or "  (none)")
    print(f"\nREJECTED ({len(rejected)}):")
    print("\n".join(f"  - {p['title'][:90]}: {p['rejected_reason']}" for p in rejected) or "  (none)")
