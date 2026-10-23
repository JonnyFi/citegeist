# Metadata sources for citegeist

Research date: 2026-10-23. All "verified" statements come from live API calls made on that date (curl, results trimmed) or from the cited documentation page as fetched on that date. "Unverified" marks statements from prior knowledge that I could not re-check (the shared web search budget ran out midway, see Gaps).

Legend: **[V]** verified live or in current docs, **[I]** my inference, **[U]** unverified.

---

## 1. DOI content negotiation via doi.org

How it works [V]: `curl -L -H "Accept: <type>" https://doi.org/<DOI>`. doi.org answers 302 to the registration agency (RA) metadata service. Crossref DOIs go to `api.crossref.org/v1/works/<doi>/transform`, DataCite to `data.crosscite.org`, mEDRA to `data.medra.org`, JaLC to `japanlinkcenter.org/data`, EU Publications Office (OP) to `ra.publications.europa.eu/data`. RA lookup per prefix: `https://doi.org/doiRA/<prefix>` (e.g. `10.1400` returns mEDRA).

Docs ([citation.doi.org/docs.html](https://citation.doi.org/docs.html), updated 2024-11-07) list Crossref, DataCite and mEDRA; status codes 200, 204 (no metadata), 404, 406 (type not available). The table there says mEDRA has no RIS, but mEDRA returned RIS in my test.

| Format | Accept header | Crossref | DataCite | mEDRA | JaLC | OP |
|---|---|---|---|---|---|---|
| CSL-JSON | `application/vnd.citationstyles.csl+json` | yes [V] | yes [V] | yes [V] | yes [V] | yes [V] |
| BibTeX | `application/x-bibtex` | yes [V] | yes [V] | yes [V] | not tested | yes [V] |
| RIS | `application/x-research-info-systems` | yes [V] | yes [V] | yes [V] (docs say no) | not tested | not tested |
| Native XML | unixref / DataCite XML / ONIX | per RA | per RA | per RA | | |

Rate limit: the Crossref transform endpoint carries the Crossref REST limits (observed header `x-rate-limit-limit: 5`, `x-rate-limit-interval: 1s` on the public pool) [V]. doi.org itself publishes no limit [V].

### Test results (trimmed)

**A. Natural science, Crossref: `10.1038/s41586-020-2649-2` (Harris et al. 2020, Nature) [V]**
CSL-JSON is essentially the full Crossref work record: title, container-title, ISSN (print+online), volume 585, issue 7825, page 357-362, issued/published-online/published-print, publisher, language `en`, abstract (JATS XML with `<jats:p>`, `<jats:sup>`), 26 authors (9 with ORCID, 0 with affiliation), 57 deposited references, license (CC BY 4.0, `tdm` and `vor`), text-mining links (PDF and HTML), `relation` (has-part, has-review), `update-policy` (Crossmark), `is-referenced-by-count` 25479. Authors now carry a `role` array (`{"vocabulary":"crossref","role":"author"}`).
BibTeX: `@article{Harris_2020, ..., month=Sept, pages={357–362}}`, no abstract, en dash in pages, URL as `http://dx.doi.org/...`.
RIS: `TY - JOUR`, `SP - 357-362` (range in SP, no EP), no abstract, both ISSNs.

**B. Social science, Taylor & Francis: `10.1191/1478088706qp063oa` (Braun & Clarke 2006) [V]**
Title, journal, 3(2), 77-101, issued 2006-01, publisher "Informa UK Limited", 70 references, 2 authors with affiliations, no abstract, no ORCID, no license.
**Also `10.1086/225469` (Granovetter 1973, AJS, U Chicago Press):** core fields only, 0 references, no abstract.

**C. German-language article, Springer: `10.1007/s11577-025-01008-x` (KZfSS 2025) [V]**
Language `de`, German abstract ("Zusammenfassung"), 74 references, CC BY 4.0, funder (Univ. Oldenburg), 4 authors but only 1 ORCID, 0 affiliations. Container title is the messy `KZfSS Kölner Zeitschrift für Soziologie und Sozialpsychologie`; publisher is the legal entity "Springer Science and Business Media LLC", not the imprint.

**D. Book chapter, Springer VS: `10.1007/978-3-658-31716-4_29` (Bogusz 2025, in "Handbuch Theorien der Soziologie") [V]**
CSL-JSON: type `book-chapter`, container-title (book title), both ISBNs, page 649-667, publisher "Springer Fachmedien Wiesbaden", language `de`, 71 references, **no editors**, no publisher-place, no abstract.
BibTeX: `@inbook{...booktitle=..., pages={649–667}}` without editor.
RIS: **`TY - GENERIC`** (not `CHAP`), ISBNs in `SN`.
Editors only appear on the parent book record `10.1007/978-3-658-31716-4` (type `book`, editors Delitz, Müller, Seyfert). A chapter therefore needs a second lookup for the parent (for Springer the DOI suffix pattern `_<n>` allows stripping; generically use the ISBN, see section 8). Crossref also holds "living reference" duplicates of the same chapter (`10.1007/978-3-658-31744-7_29-1`, pages 1-25).

**E. DataCite, arXiv: `10.48550/arXiv.1706.03762` [V]**
CSL: type `article`, title, 8 authors (family/given split), issued year only (2017), abstract, publisher "arXiv", version "7", categories, copyright "arXiv.org perpetual, non-exclusive license". No venue, no link to the NeurIPS version. BibTeX `@misc`, RIS `TY - GEN` with abstract.

**F. DataCite, Zenodo: `10.5281/zenodo.12490189` (software) [V]**
CSL: type `software`, version, license (GPL-3.0+), abstract, but the creator is `{"family":"Tanguy Fardet"}` (no split) and the ORCID is dropped. The native DataCite API record has the ORCID and `relatedIdentifiers` (IsNewVersionOf, IsVersionOf, IsDocumentedBy). Content negotiation loses data compared to the RA's own API.

**G. Other RAs [V]**
- mEDRA `10.1400/109098`: works, but names contain HTML entities (`C&#243;ceres`), ISSN without hyphen, `publisher-place: "IT"`. Needs entity decoding and normalisation.
- JaLC `10.11501/3180405`: works, no `type`, full name in `given` ("武田, 長生").
- OP (EU Publications Office) `10.2760/6280845`: works, corporate author as `literal` ("European Commission. Joint Research Centre."), type `book`. Relevant for social-science grey literature.

**Conclusion [I]:** content negotiation is the right universal first call for any DOI of unknown RA, because one code path covers all RAs. For Crossref and DataCite DOIs, the native APIs return more (DataCite: ORCIDs, relations; Crossref: `updated-by`, which CSL also carries since it is the same record). RIS and BibTeX outputs are lossy (no abstract in Crossref BibTeX/RIS, `GENERIC` for chapters); citegeist should only ingest CSL-JSON or native JSON and generate BibTeX/RIS itself.

---

## 2. Crossref REST API

### Access, limits, pricing [V]
- Pools, verified via response headers on 2026-10-23:

| Pool (`x-api-pool`) | How | Rate | Concurrency |
|---|---|---|---|
| `public-single` | no identification, single DOI | 5/s | 1 |
| `public-array` | no identification, list/query/filter | 1/s | 1 |
| `polite-single` | `mailto=` param (or mailto in User-Agent) | 10/s | 3 |
| `polite-array` | same, list/query/filter | 3/s | 3 |
| Plus | `Crossref-Plus-API-Token` header | 150/s | none |

  Sources: [Access and authentication](https://www.crossref.org/documentation/retrieve-metadata/rest-api/access-and-authentication/) (updated 2025-10-16), [community post on list-request limits](https://community.crossref.org/t/refining-rest-api-limits-for-improved-stability-and-reliability/16137) (list limits lowered effective 21 July 2026, new `x-rate-limit-type` header), [rate limit announcement blog](https://www.crossref.org/blog/announcing-changes-to-rest-api-rate-limits/). Limits are also applied per email address. 429 means back off; manual blocks give 403.
- Metadata Plus: SLA 99.5%, monthly snapshots, priority. Fees tiered by the subscriber's revenue: USD 550/yr below USD 500k, up to USD 44,000/yr ([fees](https://www.crossref.org/fees/), updated 2026-09-11). Not needed for a personal app [I].
- Public Data File: free annual dump (2026 edition about 208 GB, about 180M records up to March 2026, JSONL via Academic Torrents or AWS) per [Crossref](https://crossref.org/services/metadata-retrieval/public-data-file/). Not needed for v1 [I].
- All Crossref metadata is open (references have been open since 2022) [U for the date, V for the fact that references are returned].

### Field coverage, measured [V]
Counts via `rows=0` and `has-*` filters, journal articles published 2020-01-01 to 2024-12-31 (27,353,852 records):

| Filter | Share |
|---|---|
| has-full-text (any `link`) | 83.0% |
| has-license | 63.2% |
| has-references | 58.4% |
| has-abstract | 51.9% |
| has-update-policy (Crossmark) | 49.7% |
| has-orcid (at least one author) | 37.6% |
| has-affiliation | 30.5% |
| has-funder | 24.2% |
| has-relation | 2.2% |
| has-ror-id | 0.4% |

Book chapters 2020-2024 (5,846,165 records): abstract 7.4%, ORCID 6.6%, affiliation 3.2%, references 29.8%, funder 0.3%, license 34.4%, full-text link 50.9%.

Random sample of 300 journal articles 2020-2024 (`sample=100` three times): page 81%, article-number 21%, page or article-number 90%, volume 91%, issue 74%, abstract 49%.

Per publisher, journal articles 2020-2024:

| Member | Records | Abstract | ORCID | Affiliation | References | License |
|---|---|---|---|---|---|---|
| Informa (Taylor & Francis), 301 | 775,115 | **0.2%** | 55.0% | 86.9% | 88.5% | 28.9% |
| SAGE, 179 | 489,856 | 79.8% | 66.6% | 90.9% | 86.6% | 95.3% |
| Springer, 297 | 2,294,895 | 32.8% | 51.6% | **0.4%** | 92.4% | 96.5% |
| Wiley, 311 | 1,506,556 | 78.4% | 73.0% | 84.2% | 82.6% | 99.4% |
| Elsevier, 78 | 4,277,257 | **0.1%** | 35.1% | 0.1% | 80.4% | 97.6% |
| De Gruyter, 374 | 189,065 | 68.6% | 21.2% | 81.6% | 63.7% | 42.7% |
| OUP, 286 | 531,755 | 81.4% | 43.0% | 91.4% | 58.8% | 97.5% |
| CUP, 56 | 152,951 | 69.6% | 53.0% | 3.3% | 62.6% | 99.8% |

Implication [I]: for social science, Crossref alone is good for the citation core (title, authors, container, volume/issue/pages, year, ISSN/ISBN, type) but abstracts, ORCIDs and affiliations are missing for large publishers (T&F and Elsevier abstracts, Springer affiliations). Note that `language` exists in records but is not a valid `select` field [V].

### Corrections, retractions, Retraction Watch [V]
- The original article carries `updated-by`; the notice carries `update-to`. Each entry has `type`, `label`, `source` (`publisher` or `retraction-watch`), date and, for Retraction Watch, `record-id`. Example: Wakefield 1998 (`10.1016/S0140-6736(97)11096-0`) shows a 2004 correction and the 2010 retraction, both `source: retraction-watch`.
- `filter=update-type:retraction` returned 76,410 notices. Facet `update-type:*` on `is-update:true`: correction 216,654, erratum 118,062, retraction 76,410, new_version 44,965, new_edition 10,898, corrigendum 8,888, expression_of_concern 4,363, withdrawal 3,415, plus junk values ("retration", "retracion", "Retraction", "68818"). Normalise case and typos.
- Retraction Watch has been in the production REST API since January 2025; the Labs API integration is deprecated ([docs](https://crossref.org/documentation/retrieve-metadata/retraction-watch/), updated 2025-01-19). Daily CSV: [gitlab.com/crossref/retraction-watch-data](https://gitlab.com/crossref/retraction-watch-data) (README generated 2026-10-22; columns include OriginalPaperDOI, RetractionDOI, RetractionNature, Reason). Crossref calls it "a public resource"; neither README nor announcement names a licence. A secondary source says CC0 [U].
- Recommendation [I]: re-check `updated-by` for every library item periodically (single-DOI requests, cheap), and show a retraction banner.

### Relations [V]
`relation.type:is-preprint-of` 846,618 records, `has-preprint` 580,184; `posted-content` total 4,151,683. These cover Crossref preprint servers (bioRxiv, SSRN, Research Square, OSF etc.), not arXiv (arXiv DOIs are DataCite).

### Bibliographic search (`query.bibliographic`) [V]
- Full German reference string: correct DOI top-1 with score 168 vs 74 for the runner-up. German title only: 100 vs 40.
- Braun & Clarke reference: correct, 80 vs 57.
- Title only "The strength of weak ties": top-1 is a **2003 reprint chapter** (score 33), not the 1973 AJS article.
- Luhmann "Soziale Systeme" (book with no DOI): top-1 is a **handbook chapter about the book** (score 111). A score threshold alone would accept a false match.
- Scores are unnormalised relevance values and depend on query length. Crossref's own search-based matching with validation (SBMV) reached precision 0.981, recall 0.946, F1 0.963 on 2,000 real unstructured references ([Tkaczyk, 2018](https://www.crossref.org/blog/reference-matching-for-real-this-time/)); the earlier normalised variant divides score by reference length ([2018](https://crossref.org/blog/matchmaker-matchmaker-make-me-a-match)). Threshold values were not published.

---

## 3. DataCite REST API [V]
`https://api.datacite.org/dois/<doi>` (JSON:API). Fields seen: `types` (resourceTypeGeneral, plus ris/bibtex/citeproc mappings), `creators` with `nameIdentifiers` (ORCID) and affiliation, `titles`, `publisher`, `publicationYear`, `dates` (for arXiv: Submitted/Updated per version), `subjects`, `relatedIdentifiers`, `rightsList` with SPDX-like identifiers, `version`, `descriptions` (Abstract, Other), `fundingReferences`, `citationCount` (DataCite-tracked only: 65 for "Attention Is All You Need"), `created/registered`. No rate-limit headers observed. arXiv DOIs were registered in 2022 (`created 2022-03-04` for 1706.03762) and have **empty `relatedIdentifiers`**, so DataCite does not link arXiv preprints to journal versions. Search: `?query=...&client-id=cern.zenodo`. Documented limits not checked [U].

---

## 4. OpenAlex

### Access model 2026 [V]
- Data is CC0. API keys are free and optional for basic use, but keyless calls share **USD 0.10/day per IP** (response `meta.notice` says so). A free key gives USD 1/day ([authentication](https://help.openalex.org/api/authentication/), updated 2026-10-15; [pricing](https://help.openalex.org/access/pricing/), updated 2026-08-11; [example costs](https://help.openalex.org/access/example-costs/), updated 2026-10-09). The key-required change dates from February 2026 per the users list.
- Costs per 1,000 calls: singleton lookup (ID or DOI) **free**; list+filter USD 0.10; keyword search USD 1; semantic search USD 1; content download (PDF or GROBID TEI) USD 10. Confirmed by headers: singleton `x-ratelimit-cost-usd: 0`, search `0.001`.
- Rate: 10 req/s without key, 30 with free key, 50 on annual plans; semantic search 1/s.
- Paid plans: Member USD 5,000/yr, Member+ 10,000, Partner from 20,000. Snapshot is free on S3, refreshed **quarterly** (second Wednesday of Jan/Apr/Jul/Oct).
- Key via API: `POST https://api.openalex.org/api-keys {"email": ...}` sends a confirmation link. Param `api_key=` or `Authorization: Bearer`.

### What it adds (KZfSS example `W4412197736`) [V]
- `authorships`: all 4 authors with ORCID (Crossref: 1), institutions with ROR, `raw_affiliation_strings`, position, corresponding flags.
- `primary_topic` and `topics` (domain > field > subfield > topic, with score), `keywords`, `concepts` (legacy), SDGs, `mesh`.
- `referenced_works` (59 resolved of 74 Crossref references), `related_works` (10), `cited_by_count`, `counts_by_year`, `fwci`, percentiles.
- `open_access`, `best_oa_location`, `locations` (version, license, PDF URL), `has_content` (`pdf`, `grobid_xml`) and `content_urls` (cached full text for 50M+ OA works).
- `abstract_inverted_index` (must be rebuilt into text), `is_retracted`, `funders`, `awards`, `indexed_in`, `ids` (MAG, PMID).
- Two corpora: curated core and opt-in expansion (formerly XPAC).

### Quality problems observed [V]
- **Elsevier abstracts absent** (`10.1016/j.respol.2019.103834`, Wakefield): `abstract_inverted_index` null. Semantic Scholar had the Elsevier abstract.
- **Wrong OA locations:** for Braun & Clarke, OpenAlex lists a HAL PDF and a Dialnet PDF that belong to other papers, and a T&F `doi/abs` page as `pdf_url` with `other-oa`. Unpaywall says `closed` for the same DOI, although the docs say both share one database.
- **Junk DOI merged into a famous work:** "Attention Is All You Need" (`W2626778328`) now shows primary DOI `10.65215/2q58a426`, type `preprint`, year **2025**. That DOI is a Crossref posted-content record from "Shenzhen Medical Academy of Research and Translation" dated 2025-08-23 (eight such DOIs). OpenAlex must never override DOI, year or type from a primary source.
- For the Higgs paper, the arXiv DOI and the PLB DOI resolve to the same OpenAlex work (good preprint/published linking).

---

## 5. Semantic Scholar Graph API [V]
- Endpoints (OpenAPI spec): `/paper/{id}`, `/paper/batch` (POST, up to 500 IDs), `/paper/search`, `/paper/search/bulk`, `/paper/search/match` (title match with `matchScore`), `/paper/autocomplete`, `/paper/{id}/citations|references` (each edge with `contexts`, `intents`, `contextsWithIntent`, `isInfluential`), `/snippet/search` (about 500-word full-text snippets), author endpoints. Recommendations: `/recommendations/v1/papers/forpaper/{id}` with `from=recent` (default) or `all-cs`.
- Paper fields: `paperId`, `corpusId`, `externalIds` (DOI, ArXiv, MAG, DBLP, PMID...), `title`, `abstract`, `venue`, `publicationVenue`, `year`, `publicationDate`, `journal` (name, volume, pages), `publicationTypes`, `authors`, `citationCount`, `referenceCount`, `influentialCitationCount`, `isOpenAccess`, `openAccessPdf` (url, status, license), `fieldsOfStudy`, `s2FieldsOfStudy`, `citationStyles.bibtex`, `embedding` (`specter_v2`, 768 dims verified), `tldr` (`tldr@v2.0.0`), `textAvailability` (fulltext/abstract/none).
- ID prefixes accepted: `DOI:`, `ARXIV:`, `CorpusId:`, `MAG:`, `ACL:`, `PMID:`, `PMCID:`, `URL:` [U for the full list, DOI and ARXIV verified].
- Limits: keyless traffic shares one pool across all unauthenticated users (docs: 1000 req/s shared); in practice I got **repeated 429s** and needed 3 to 8 retries with 6 s waits. A key starts at 1 req/s ([product page](https://www.semanticscholar.org/product/api)). Licence ([API License Agreement](https://www.semanticscholar.org/product/api/license), 2023-05-17): attribution to "Semantic Scholar" required, no redistribution of the API, datasets carry their own licences (examples given: CC BY-NC, ODC-BY).
- Observed quality [V]:
  - Transformer paper: arXiv merged with NeurIPS venue, tldr present, 198,192 citations, `openAccessPdf.url` empty.
  - KZfSS paper: German abstract present, tldr null, no fields of study, no affiliations.
  - Elsevier paper: abstract present (OpenAlex had none).
  - **Braun & Clarke: DOI lookup 404**; title match returns a corrupted record "Please Scroll down for Article Qualitative Research in Psychology Using Thematic Analysis in Psychology" with no DOI, year or abstract.
  - **Recommendations for the German KZfSS paper were unrelated** (allergology data protection, cancer, Borrelia). For the transformer with `from=all-cs` they were relevant.
- Conclusion [I]: useful as an abstract fallback, for TLDRs, influential citations and citation contexts in CS and biomedicine; weak for German and older social-science literature. Do not depend on it in the critical path.

---

## 6. Unpaywall [V]
- `https://api.unpaywall.org/v2/<doi>?email=<address>`; "Please limit use to 100,000 calls per day" (text in the site bundle of [unpaywall.org/products/api](https://unpaywall.org/products/api)).
- Since late 2025 Unpaywall is "a legacy-compatible API surface over the OpenAlex database"; Crossref DOIs only (DataCite DOIs return 404) ([help.openalex.org/access/unpaywall](https://help.openalex.org/access/unpaywall/)). The field `evidence` now returns `"deprecated"`, `data_standard: 2`.
- Returns `is_oa`, `oa_status`, `best_oa_location` (`url_for_pdf`, `host_type`, `version`, `license`), `oa_locations`, `has_repository_copy`, `z_authors`.
- KZfSS: hybrid, publisher PDF, CC BY. Braun & Clarke: closed (OpenAlex: hybrid, with wrong locations).
- Conclusion [I]: OpenAlex already contains this data, so Unpaywall is optional. Any downloaded PDF must be verified against the expected title/DOI before attaching it.

---

## 7. arXiv [V]
- API `https://export.arxiv.org/api/query?id_list=...` (Atom XML, now served by Google Frontend). Fields: id with version, title, summary, authors (names, affiliations rare), published (v1), updated (latest), categories and `arxiv:primary_category`, `arxiv:comment`, `arxiv:journal_ref` and `arxiv:doi` (author-supplied, e.g. 1207.7214 gives `Phys.Lett. B716 (2012) 1-29`, `10.1016/j.physletb.2012.08.020`), PDF and abstract links.
- Terms ([API ToU](https://info.arxiv.org/help/api/tou.html)): at most one request every three seconds, one connection at a time, across all your machines. Metadata is CC0. E-prints may be used for personal or research purposes but not re-served without permission or a suitable licence. Do not imply endorsement.
- HTML: launched 2023-12-18 for TeX submissions from 2023-12-01 ([arXiv blog, 2023-12-21](https://blog.arxiv.org/2023/12/21/accessibility-update-arxiv-now-offers-papers-in-html-format/)); the backfill of the older corpus is ongoing ([accessible HTML](https://info.arxiv.org/about/accessible_HTML.html)). Measured: **39 of 40** recent papers (2610.30251 to 2610.30399, mixed categories) and **16 of 17** older papers (2012 to 2023) return `https://arxiv.org/html/<id>` with HTTP 200. Generator comment: "LaTeXML oxide (version 0.7.6)". A 200 does not prove a clean conversion; inspect `ltx_ERROR` markers (none in my 3 samples).
- LaTeX source: `https://arxiv.org/e-print/<id>` redirects (301) to `/src/<id>`, which serves `application/gzip` (`arXiv-1706.03762v7.tar.gz`, 1.15 MB). Some submissions are PDF-only [U].
- DOIs: every paper has `10.48550/arXiv.<id>` at DataCite (registered 2022) with abstract and versions, but no relation to the published version.
- Preprint-to-published linking: `arxiv:doi`/`journal_ref` (author-supplied, often missing [U]), OpenAlex work merging (verified for 1207.7214), Semantic Scholar merging (verified for 1706.03762), DBLP for CS [U].

---

## 8. Books and ISBN lookup

Test ISBNs: Luhmann *Soziale Systeme* stw (9783518282663), Reckwitz *Gesellschaft der Singularitäten* (9783518587065), *Handbuch Theorien der Soziologie* Springer VS print (9783658317157), Putnam *Bowling Alone* paperback (9780743203043).

| Source | Result [V] |
|---|---|
| **DNB SRU** `services.dnb.de/sru/dnb?...query=num%3D<isbn>&recordSchema=MARC21-xml` (also `oai_dc`), no key | All 3 German ISBNs found. Luhmann returned 5 records (one per printing, 1993, 1994...). Roles (Verfasser, Herausgeber), place, imprint "Springer VS", year 2025, extent "XXI, 846 Seiten", DDC, GND IDs, links to the **table of contents PDF** (`d-nb.info/<idn>/04`) and publisher blurb. MARC 700 had only the first editor; all three appear in 245$c. |
| **K10plus SRU** `sru.k10plus.de/opac-de-627?...query=pica.isb%3D<isbn>&recordSchema=marcxml` | Handbuch: 2 records (print and e-book), **all three editors with GND IDs**, series "Springer Nature reference", DOI link, imprint. |
| **Open Library** `openlibrary.org/api/books?bibkeys=ISBN:<isbn>&jscmd=data` | All 4 found. Luhmann dated "2001" (reprint), Handbuch editors listed as `authors` and year 2022, Putnam fine. |
| **Library of Congress SRU** `lx2.loc.gov/sru/lcdb` (Zotero uses `https://lx2.loc.gov/sru/lcdb?...bath.ISBN=^<isbn>`) | Putnam paperback ISBN: 0 records; hardcover 9780684832838: found. Title search relevance is poor. |
| **Google Books** `googleapis.com/books/v1/volumes?q=isbn:` keyless | **Every call failed**: "Quota exceeded ... Queries per day" for the shared anonymous project. Needs an API key. |
| **WorldCat** | The official Search API needs an OCLC institutional WSKey [U]. Zotero's "Open WorldCat" translator (updated 2026-08-28) calls `search.worldcat.org/api/search?q=bn:<isbn>` with a Referer header, i.e. the undocumented website backend. Fragile; not for citegeist. |
| **Crossref** | Has many scholarly books and chapters with ISBN (Springer, De Gruyter, OUP, CUP, Nomos 10.5771, transcript etc.) [V for Springer]. Filter `isbn:<isbn>` for book records [U, not run]. |

What Zotero uses [V, from [zotero/translators](https://github.com/zotero/translators) source]: search translators that accept ISBNs, run in ascending priority order: Library of Congress ISBN (97), BnF ISBN (98), K10plus ISBN (99; the old "Gemeinsamer Bibliotheksverbund ISBN" is disabled), Open WorldCat (100). For DOIs: Crossref REST (90), then DOI Content Negotiation (100). There is no DNB translator.

Edited volumes and chapters [I]: chapter-level records exist almost only where the publisher registers chapter DOIs (Springer, De Gruyter, Nomos, OUP, CUP, Sage reference). For other German publishers (Suhrkamp, Campus, Beltz Juventa, transcript print-only) the user creates the chapter manually, and citegeist fills the parent book from DNB/K10plus. The DNB table-of-contents PDF can feed an agent that proposes chapter title, author and page range. Book records carry editors; chapter records carry authors. citegeist must model `container` (book) and `contribution` (chapter) separately and inherit editor, publisher, place, year and ISBN from the parent.

---

## 9. PubMed / Europe PMC [U, not tested live]
- NCBI E-utilities (`esummary`/`efetch` by PMID, `idconv` for PMID/PMCID/DOI): 3 req/s without key, 10 req/s with a free key; asks for `tool` and `email` parameters. Strong for biomedicine (MeSH, abstracts, publication types including retraction flags).
- Europe PMC REST (`ebi.ac.uk/europepmc/webservices/rest/search?query=DOI:...&resultType=core`): no key, JSON, abstracts, full text for the OA subset, citations and references.
- Relevance for a social-science PhD [I]: low; implement as a v2 resolver for PMIDs only.

---

## 10. Identifying a PDF without a known identifier

Cascade observed in Zotero [V, from `chrome/content/zotero/xpcom/recognizeDocument.js`]: the Zotero PDF worker (pdf.js based) extracts "recognizer data" from the file (text of the first pages and layout), posts it as JSON to Zotero's recognizer web service, and receives `arxiv`, `doi`, `isbn` or a title-level result. It then resolves arXiv IDs and DOIs through translators, ISBNs through the ISBN search translators (checking that the returned ISBN matches), and otherwise creates an item from the returned title. The server side is not open, and its endpoint and heuristics were not inspected [U]. For EPUB, Zotero reads DOIs and ISBNs from the RDF metadata and from the section documents. I found no published success rate (search budget exhausted, [U]).

Recommended local cascade for citegeist [I]:
1. **Embedded identifiers:** read XMP (`prism:doi`, `dc:identifier`, `pdfx:doi`) and the Info dictionary; regex the first 2 pages and the last page for DOI (Zotero/translator regex `\b10\.[0-9]{4,}\/[^\s&"']*[^\s&"'.,]`, then strip trailing punctuation and ignore DOIs inside the reference list), arXiv IDs (`arXiv:\d{4}\.\d{4,5}(v\d+)?` and old `[a-z\-]+(\.[A-Z]{2})?/\d{7}`), ISBN (checksum-validated) and the arXiv stamp in the left margin. Publisher PDFs usually print the DOI on page 1 [U as a rate].
2. **Header extraction:** GROBID `processHeaderDocument` (title, authors, affiliations, abstract, DOI if printed). Optionally the LLM on the first page text, since inference already runs on the user's subscription.
3. **Candidate search:** Crossref `query.bibliographic` with "first author + title + year" (rows=5), OpenAlex `filter=title.search:` (paid list call, USD 0.0001) and Semantic Scholar `/paper/search/match`.
4. **Validation (mandatory):** normalised title similarity (e.g. token-set ratio at least 0.9), first-author surname match, year within ±1 (preprint vs print), type compatibility (reject `book-chapter` "about" a book, reviews and reprints). Accept automatically only above the threshold; otherwise show the top 3 to the user or agent. The Luhmann and Granovetter tests above show why.
5. **Verify downloaded PDFs** the same way, since OA locations are sometimes wrong.

GROBID facts [U, not re-verified]: Apache-2.0, Java service, Docker images; header model with CRF or deep-learning variants; reported header-field accuracy around 0.9 for titles on PubMed Central style test sets. OpenAlex already serves GROBID TEI for 50M+ OA works [V], which can be fetched for USD 0.01 each instead of running GROBID locally.

---

## 11. Citation graph sources

| Source | Coverage seen [V] | Licence | Access |
|---|---|---|---|
| Crossref `reference` | deposited reference lists (58% of 2020-2024 articles, 30% of chapters); many lack DOIs | metadata open, CC0 per Crossref [U for the formal statement] | REST, free |
| OpenCitations Index | 2,559,460,009 citations; Index dump July 2026 (sources: Crossref Feb 2026, JaLC Aug 2025, OUTCITE, Matilda); Meta dump June 2026 (147M+ entities, OpenAlex ID alignment) ([downloads](https://download.opencitations.net/)) | **CC0** ([about](https://opencitations.net/about)) | API v2.2.0: 180 req/min per IP, optional token ([docs](https://api.opencitations.net/index/v2)) |
| OpenAlex | `referenced_works`, `cited_by` via `filter=cites:W...`, `related_works` | CC0 | list calls cost USD 0.0001 each |
| Semantic Scholar | citations and references with contexts, intents, `isInfluential` | API licence with attribution, datasets with their own licences | key recommended |

Comparison for one German paper (KZfSS): Crossref 74 references, OpenAlex 59 resolved, OpenCitations 51. Braun & Clarke citation counts: OpenAlex 193,381, OpenCitations 147,219. OpenCitations Meta **title-cases** titles ("Forschungsnotiz Zu PISA ... Zum Einfluss Des Familialen ..."), so never take titles from it.

---

## 12. Recommendation for citegeist

### Resolver cascade per input

| Input | Steps |
|---|---|
| **DOI** | 1. Normalise (lowercase, strip `https://doi.org/`, `doi:`). 2. Crossref `/works/<doi>` (polite, 10/s); on 404 call `doi.org` CSL-JSON content negotiation, which covers DataCite, mEDRA, JaLC, OP and others. For DataCite DOIs also call `api.datacite.org/dois/<doi>` (ORCID, relations). 3. If type is `book-chapter`, fetch the parent book (Crossref by ISBN or DOI-stem, else DNB/K10plus) for editors and place. 4. Enrich with OpenAlex singleton (free): ORCIDs, institutions, topics, `referenced_works`, OA locations, abstract if missing. 5. If abstract is still missing: Semantic Scholar (keyed, 1/s), then the publisher landing page `citation_abstract` meta tags [U]. |
| **arXiv ID** | arXiv API (1 per 3 s) for versions, comment, `journal_ref`, `doi`. If a published DOI exists (arXiv field, OpenAlex locations or S2 externalIds), resolve it as a DOI and link both as versions of one work. Fetch `arxiv.org/html/<id>` for the agent-readable text; fall back to `/src/<id>` LaTeX, then PDF. |
| **ISBN** | 1. Validate and normalise to ISBN-13. 2. If the prefix is German-language (978-3) query DNB SRU MARC21 first, then K10plus. Otherwise query K10plus, then Library of Congress SRU, then Open Library. 3. Crossref `filter=isbn:` to find book or chapter DOIs. Google Books only with the user's own API key. |
| **PMID/PMCID** | NCBI `idconv` to a DOI, then the DOI path; E-utilities for MeSH (v2). |
| **URL** | Recognise doi.org, arxiv.org, PubMed and publisher patterns; otherwise fetch HTML and read `citation_*` Highwire tags, `dc.*`, JSON-LD and `<meta name="citation_doi">` (the tag list Unpaywall uses); then the DOI path. Zotero's translators are the reference implementation for site-specific scraping [I]. |
| **PDF only** | Section 10 cascade with mandatory validation. |

### Field-level merge with provenance [I]
Store every value as `(field, value, source, source_record_id, fetched_at, confidence)` and compute the displayed record from rules. User and agent edits are a source of their own and always win; refreshes never overwrite them.

| Field | Precedence | Reason |
|---|---|---|
| DOI, type, container, volume, issue, pages, article-number, ISSN, ISBN, publisher, issued date | RA record (Crossref/DataCite/mEDRA) > arXiv (preprints) > DNB/K10plus (books) > OpenAlex > S2 | The publisher deposited them; OpenAlex/S2 merges can corrupt DOI, year and type (the 10.65215 example). |
| Title | RA record; DNB/K10plus for German books (correct capitalisation, subtitle split) | OpenCitations title-cases; S2 can carry PDF-cover garbage. |
| Authors (names, order) | RA record > DNB/K10plus (books, with GND) > OpenAlex | Order and spelling as published. |
| Author ORCID, affiliation, ROR | Crossref if present, else OpenAlex authorships (raw strings + ROR), each tagged with source | OpenAlex fills gaps (4 of 4 ORCIDs vs 1 of 4 in the test). |
| Editors, place, edition, series | Parent book record; DNB/K10plus for German books | Chapter records omit them. |
| Abstract | Crossref (strip JATS) > arXiv > DataCite > OpenAlex (rebuild inverted index) > S2 > publisher page | Keep the language tag; keep both German and English abstracts if present. |
| Language | Crossref `language` > DNB `041` > OpenAlex > detection on the text | |
| Topics, keywords | OpenAlex topics/keywords as machine tags, kept separate from user tags | |
| References, citations | Crossref references (raw) linked through OpenAlex/OpenCitations IDs; counts from OpenAlex, displayed with source and date | Counts differ by 30% between sources. |
| OA/PDF URL | OpenAlex `best_oa_location` / Unpaywall, then verify the downloaded file | Wrong locations observed. |
| Retraction, correction | Crossref `updated-by` (publisher + Retraction Watch), OpenAlex `is_retracted` as backup | |
| Licence | Crossref `license` (`vor` content-version) > OpenAlex location licence | |
| Embedding | Computed locally on the converted full text; S2 SPECTER2 only as optional enrichment | SPECTER2 performs badly on German text (recommendation test). |

### Caching and etiquette [I]
- Cache raw responses per `(source, id)` in SQLite as JSON together with ETag/Last-Modified and `fetched_at`. Metadata rarely changes: refresh on demand, plus a weekly background check of `updated-by` for library items and a monthly OpenAlex enrichment refresh.
- One HTTP client per source with a token bucket: Crossref 10/s single and 3/s list with concurrency 3; arXiv 1 per 3 s with a single connection; OpenAlex at most 30/s with a key and a budget meter that reads `x-ratelimit-remaining-usd`; S2 1/s with a key; OpenCitations below 3/s; DNB/K10plus about 1/s (no published limit [U]).
- Honour 429 and `Retry-After` with exponential backoff and jitter; treat S2 500s like 429.
- Identify: `User-Agent: citegeist/<version> (mailto:<user email>)` and `mailto=` for Crossref, `email=` for Unpaywall, `api_key` for OpenAlex. Use the **user's** address, configured at first run, since Crossref limits per email address and a shared address would pool all users.
- Agents and the MCP server call the same cached resolver, never the remote APIs directly, so an agent loop cannot exhaust the quotas.

### Minimal API set for v1 [I]
1. **Crossref REST** (DOIs, search, retractions).
2. **doi.org content negotiation** (all non-Crossref DOIs).
3. **OpenAlex** with a free key (enrichment, references, OA locations, abstracts; singleton lookups are free).
4. **arXiv API plus arxiv.org/html** (preprints, agent-readable text).
5. **DNB SRU and K10plus SRU** (German and other books, edited volumes).
6. **Open Library** (non-German book fallback, no key).

Deferred to v2: DataCite native API, Semantic Scholar (needs a key, weak for German), Unpaywall (covered by OpenAlex), OpenCitations, PubMed/Europe PMC, Library of Congress, Google Books (key), local GROBID (OpenAlex TEI or the LLM can cover headers first).

---

## Gaps and uncertainties
- The shared web-search budget ran out during the session. Not re-verified: PubMed/Europe PMC limits, GROBID accuracy figures, Zotero recognizer server endpoint and success rates, WorldCat API terms, Crossref `isbn:` filter behaviour, Retraction Watch data licence, the complete S2 ID prefix list and current keyed S2 limits beyond "introductory 1 RPS".
- The arXiv HTML share comes from a sample of 57 IDs, not from an official statistic.
- Crossref coverage numbers are filter counts for 2020-2024 publication dates; older literature (important in social science) will have lower coverage [I].
- The Unpaywall/OpenAlex disagreement on Braun & Clarke may come from a refresh lag; it was observed once.
