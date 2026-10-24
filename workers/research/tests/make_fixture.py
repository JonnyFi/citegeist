"""Writes tests/fixtures/run-sample/ through the pipeline's own render.write_csv.

The rows mirror a real run (topic "agent communication protocols"): one paper per section, one
snowballed paper, one without an OpenAlex id. Rerun after a change to render.CSV_FIELDS:

  CITEGEIST_LITSEARCH_DIR=/tmp/x uv run python tests/make_fixture.py
"""

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "scripts"))

import render  # noqa: E402

OUT = os.path.join(HERE, "fixtures", "run-sample")

BASE = {"venue_type": "", "found_in": "", "venue_canonical": "", "venue_field": "", "type": "article",
        "is_preprint": False, "is_grey": False, "verified_by": "crossref", "doi_origin": "openalex",
        "influential_citations": 0, "max_h_source": "openalex", "institutions": [], "listed_institutions": [],
        "volume": "", "issue": "", "pages": "", "abstract_source": "openalex", "tldr": "", "summary_source": "abstract",
        "sources": ["openalex"], "venue_note": "", "dblp_venue": "", "dblp_track": "", "dblp_key": "",
        "openreview_status": "", "openreview_venue": "", "openreview_forum": "", "h_index_note": "", "snowball": ""}

ROWS = [
    {**BASE, "section": "main", "rank": 1, "score": 81.4, "score_relevance": 27.0, "score_venue": 30.0,
     "score_author": 12.4, "score_citations": 12.0, "why_selected": "Tier-1 venue, high relevance, FWCI 3.1",
     "relevance": 90, "relevance_note": "rank 2 for query 1", "title": "A Survey of Agent Interoperability Protocols",
     "authors": ["Ana Ruiz", "Tom Becker"], "year": 2025, "publication_date": "2025-03-14",
     "venue": "ACM Computing Surveys", "venue_tier": 1, "doi": "10.1145/3700001", "verified_doi": "10.1145/3700001",
     "arxiv_id": "", "openalex_id": "W4400000001", "cited_by_count": 120, "citations_per_year": 60.0, "fwci": 3.1,
     "max_h_index": 31, "max_h_author": "Ana Ruiz", "abstract": "We survey MCP, ACP, A2A and ANP.",
     "summary": "Surveys four agent protocols.", "queries": ['"agent communication protocol"'], "rejected_reason": ""},
    {**BASE, "section": "main", "rank": 2, "score": 64.0, "score_relevance": 24.0, "score_venue": 18.0,
     "score_author": 10.0, "score_citations": 12.0, "why_selected": "found via snowballing, Tier-2 venue",
     "relevance": 80, "relevance_note": "", "title": "Emergent Communication in Multi-Agent Reinforcement Learning",
     "authors": ["Li Wei"], "year": 2022, "publication_date": "2022-06-01", "venue": "AAMAS", "venue_tier": 2,
     "doi": "10.5555/3535850.3535900", "verified_doi": "10.5555/3535850.3535900", "arxiv_id": "",
     "openalex_id": "W4200000002", "cited_by_count": 45, "citations_per_year": 11.3, "fwci": None,
     "max_h_index": 18, "max_h_author": "Li Wei", "abstract": "<p>Abstract: We study emergent protocols.</p>",
     "summary": "Studies emergent protocols.", "queries": [], "snowball": "cited by W4400000001",
     "rejected_reason": ""},
    {**BASE, "section": "preprint", "rank": 1, "score": 55.5, "score_relevance": 30.0, "score_venue": 6.0,
     "score_author": 9.5, "score_citations": 10.0, "why_selected": "not peer-reviewed, very high relevance",
     "relevance": 100, "relevance_note": "rank 1 for query 2", "title": "LLM Agents Talking: A Benchmark",
     "authors": ["Sam Okafor", "Ines Vogel", "Kai Lund"], "year": 2026, "publication_date": "2026-01-20",
     "venue": "arXiv", "venue_tier": "", "is_preprint": True, "doi": "10.48550/arXiv.2601.01234",
     "verified_doi": "10.48550/arXiv.2601.01234", "verified_by": "datacite", "arxiv_id": "2601.01234",
     "openalex_id": "W4600000003", "cited_by_count": 3, "citations_per_year": 3.0, "fwci": 1.2,
     "max_h_index": 9, "max_h_author": "Ines Vogel", "abstract": "A benchmark for LLM agent dialogue.",
     "summary": "Benchmark for agent dialogue.", "queries": ['"multi-agent communication" LLM'],
     "openreview_status": "under review", "rejected_reason": ""},
    {**BASE, "section": "grey", "rank": 1, "score": 30.0, "score_relevance": 20.0, "score_venue": 0.0,
     "score_author": 5.0, "score_citations": 5.0, "why_selected": "grey literature (Zenodo)",
     "relevance": 67, "relevance_note": "", "title": "Agent Protocol Interop Notes", "authors": ["Open Lab"],
     "year": 2024, "publication_date": "2024-09-09", "venue": "Zenodo", "venue_tier": "", "is_grey": True,
     "type": "report", "doi": "10.5281/zenodo.1234567", "verified_doi": "10.5281/zenodo.1234567",
     "verified_by": "datacite", "arxiv_id": "", "openalex_id": "", "cited_by_count": 0,
     "citations_per_year": 0.0, "fwci": None, "max_h_index": 0, "max_h_author": "", "abstract": "",
     "summary": "", "queries": ['"agent communication protocol"'], "rejected_reason": ""},
    {**BASE, "section": "rejected", "rank": "", "score": 40.0, "score_relevance": 20.0, "score_venue": 10.0,
     "score_author": 5.0, "score_citations": 5.0, "why_selected": "", "relevance": 67, "relevance_note": "",
     "title": "Agent Communication, Revisited", "authors": ["J. Doe"], "year": 2023, "publication_date": "",
     "venue": "Some Workshop", "venue_tier": "", "doi": "10.9999/fake.1", "verified_doi": "",
     "verified_by": "", "arxiv_id": "", "openalex_id": "W4300000005", "cited_by_count": 1,
     "citations_per_year": 0.5, "fwci": None, "max_h_index": 2, "max_h_author": "J. Doe",
     "abstract": "", "summary": "", "queries": ['"agent communication protocol"'],
     "rejected_reason": "DOI not found at Crossref or DataCite"},
]

RUN = {"id": "run-sample", "topic": "agent communication protocols",
       "queries": ['"agent communication protocol"', '"multi-agent communication" LLM'], "dropped_queries": [],
       "since": 2022, "top": 10, "created": "2026-10-24T14:30:00", "status": "done",
       "counts": {"main": 2, "preprint": 1, "grey": 1, "rejected": 1}, "attempts": 1,
       "finished": "2026-10-24T14:34:12"}

if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    render.write_csv(os.path.join(OUT, "papers.csv"), ROWS)
    with open(os.path.join(OUT, "run.json"), "w", encoding="utf-8") as f:
        json.dump(RUN, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print(f"wrote {OUT}")
