import { fileURLToPath } from "node:url";
import type { TitleQuery } from "./match.js";
import type { MetadataFields } from "./types.js";

export const FIXTURE_DIR = fileURLToPath(new URL("../../../fixtures/metadata", import.meta.url));

export interface FixtureCase {
  name: string;
  input: string;
  /** Fields the merged record must contain exactly (deep equality per key). */
  expect: Partial<MetadataFields>;
  /** Provenance source expected for chosen keys, e.g. { title: "crossref" }. */
  from?: Record<string, string>;
}

export const CASES: FixtureCase[] = [
  {
    name: "Nature article with many authors",
    input: "10.1038/s41586-020-2649-2",
    expect: {
      type: "article-journal",
      title: "Array programming with NumPy",
      issued: "2020-09-16",
      "container-title": "Nature",
      volume: "585",
      issue: "7825",
      page: "357-362",
      DOI: "10.1038/s41586-020-2649-2",
      ISSN: "0028-0836",
      language: "en",
    },
    from: { title: "crossref", "author.orcid": "openalex" },
  },
  {
    name: "Taylor and Francis article, abstract only in OpenAlex",
    input: "10.1191/1478088706qp063oa",
    expect: {
      type: "article-journal",
      title: "Using thematic analysis in psychology",
      issued: "2006-01",
      "container-title": "Qualitative Research in Psychology",
      volume: "3",
      issue: "2",
      page: "77-101",
      DOI: "10.1191/1478088706qp063oa",
      ISSN: "1478-0887",
    },
    from: { title: "crossref", abstract: "openalex" },
  },
  {
    name: "American Journal of Sociology 1973",
    input: "10.1086/225469",
    expect: {
      type: "article-journal",
      title: "The Strength of Weak Ties",
      issued: "1973-05",
      "container-title": "American Journal of Sociology",
      volume: "78",
      issue: "6",
      page: "1360-1380",
      publisher: "University of Chicago Press",
      DOI: "10.1086/225469",
      ISSN: "0002-9602",
    },
  },
  {
    name: "German-language sociology article",
    input: "10.1007/s11577-025-01008-x",
    expect: {
      type: "article-journal",
      issued: "2025-06",
      "container-title": "KZfSS Kölner Zeitschrift für Soziologie und Sozialpsychologie",
      volume: "77",
      issue: "2",
      page: "247-269",
      DOI: "10.1007/s11577-025-01008-x",
      language: "de",
    },
    from: { "author.orcid": "openalex" },
  },
  {
    name: "Book chapter gets editors from the parent book",
    input: "10.1007/978-3-658-31716-4_29",
    expect: {
      type: "chapter",
      title: "Soziologie als Erfahrungswissenschaft: Die Chicago School of Sociology",
      "container-title": "Handbuch Theorien der Soziologie",
      page: "649-667",
      ISBN: "9783658317157",
      "publisher-place": "Wiesbaden",
      language: "de",
      editor: [
        { family: "Delitz", given: "Heike" },
        { family: "Müller", given: "Julian" },
        { family: "Seyfert", given: "Robert" },
      ],
    },
    from: { editor: "crossref", title: "crossref" },
  },
  {
    name: "Retracted Lancet article without abstract",
    input: "10.1016/S0140-6736(97)11096-0",
    expect: {
      type: "article-journal",
      issued: "1998-02",
      "container-title": "The Lancet",
      volume: "351",
      issue: "9103",
      page: "637-641",
      DOI: "10.1016/s0140-6736(97)11096-0",
    },
  },
  {
    name: "Political science article with capitalised author names",
    input: "10.1017/S0003055403000534",
    expect: {
      type: "article-journal",
      title: "Ethnicity, Insurgency, and Civil War",
      issued: "2003-02",
      "container-title": "American Political Science Review",
      volume: "97",
      issue: "01",
      page: "75-90",
      ISSN: "0003-0554",
    },
  },
  {
    name: "SAGE article with PMID from OpenAlex",
    input: "10.1177/1049732305276687",
    expect: {
      type: "article-journal",
      title: "Three Approaches to Qualitative Content Analysis",
      issued: "2005-11",
      "container-title": "Qualitative Health Research",
      volume: "15",
      issue: "9",
      page: "1277-1288",
      publisher: "SAGE Publications",
      ids: { openalex: "W2142225512", pmid: "16204405" },
    },
  },
  {
    name: "Annual Review of Sociology",
    input: "10.1146/annurev.soc.24.1.1",
    expect: {
      type: "article-journal",
      title: "Social Capital: Its Origins and Applications in Modern Sociology",
      issued: "1998-08",
      "container-title": "Annual Review of Sociology",
      volume: "24",
      issue: "1",
      page: "1-24",
      publisher: "Annual Reviews",
    },
  },
  {
    name: "DataCite DOI of an arXiv preprint",
    input: "10.48550/arXiv.1706.03762",
    expect: {
      type: "article",
      title: "Attention Is All You Need",
      issued: "2017",
      publisher: "arXiv",
      DOI: "10.48550/arxiv.1706.03762",
      URL: "https://arxiv.org/abs/1706.03762",
    },
    from: { title: "doi.org", "ids.arxiv": "doi.org" },
  },
  {
    name: "DataCite DOI of Zenodo software",
    input: "10.5281/zenodo.12490189",
    expect: {
      type: "software",
      title: "NNGT 2.8.0: support numpy >= 2",
      issued: "2024-06-23",
      publisher: "Zenodo",
      DOI: "10.5281/zenodo.12490189",
      author: [{ family: "Fardet", given: "Tanguy" }],
    },
  },
  {
    name: "mEDRA DOI with HTML entities",
    input: "10.1400/109098",
    expect: {
      type: "article-journal",
      title: "Traducción en español",
      issued: "2008",
      "container-title": "Studi buzzatiani : rivista del centro studi Buzzati",
      ISSN: "1124-6286",
      language: "es",
      author: [{ family: "Cóceres", given: "María Beatriz" }],
    },
    from: { title: "doi.org" },
  },
  {
    name: "EU Publications Office DOI with corporate author",
    input: "10.2760/6280845",
    expect: {
      type: "book",
      issued: "2025",
      publisher: "Publications Office",
      author: [{ literal: "European Commission. Joint Research Centre." }],
    },
    from: { title: "doi.org" },
  },
  {
    name: "arXiv id, new style",
    input: "arXiv:1706.03762v7",
    expect: {
      type: "article",
      title: "Attention Is All You Need",
      issued: "2017-06-12",
      publisher: "arXiv",
      DOI: "10.48550/arxiv.1706.03762",
      ids: { arxiv: "1706.03762", openalex: "W2626778328" },
    },
    from: { title: "arxiv", abstract: "arxiv" },
  },
  {
    name: "arXiv id, old style with published DOI",
    input: "arXiv:hep-th/9711200",
    expect: {
      type: "article-journal",
      title: "The Large-N Limit of Superconformal Field Theories and Supergravity",
      "container-title": "International Journal of Theoretical Physics",
      volume: "38",
      issue: "4",
      page: "1113-1133",
      DOI: "10.1023/a:1026654312961",
    },
    from: { DOI: "crossref", abstract: "arxiv", "ids.arxiv": "arxiv" },
  },
  {
    name: "arXiv id, four digit sequence number",
    input: "arXiv:1409.0473",
    expect: {
      type: "article",
      title: "Neural Machine Translation by Jointly Learning to Align and Translate",
      issued: "2014-09-01",
      ids: { arxiv: "1409.0473", openalex: "W2133564696" },
    },
  },
  {
    name: "German ISBN-13 from DNB, Luhmann",
    input: "ISBN 978-3-518-28266-3",
    expect: {
      type: "book",
      title: "Soziale Systeme",
      ISBN: "9783518282663",
      publisher: "Suhrkamp",
      "publisher-place": "Frankfurt am Main",
      language: "de",
      author: [{ family: "Luhmann", given: "Niklas" }],
    },
    from: { title: "dnb" },
  },
  {
    name: "German ISBN-13 from DNB, Reckwitz",
    input: "9783518587065",
    expect: {
      type: "book",
      title: "Die Gesellschaft der Singularitäten",
      subtitle: "zum Strukturwandel der Moderne",
      issued: "2017",
      publisher: "Suhrkamp",
      "publisher-place": "Berlin",
      author: [{ family: "Reckwitz", given: "Andreas" }],
    },
    from: { title: "dnb" },
  },
  {
    name: "Edited volume, all editors from K10plus",
    input: "9783658317157",
    expect: {
      type: "book",
      title: "Handbuch Theorien der Soziologie",
      issued: "2025",
      publisher: "Springer VS",
      language: "de",
      editor: [
        { family: "Delitz", given: "Heike" },
        { family: "Müller", given: "Julian" },
        { family: "Seyfert", given: "Robert" },
      ],
    },
    from: { editor: "k10plus" },
  },
  {
    name: "ISBN-10 input, non-German book from K10plus",
    input: "0-7432-0304-6",
    expect: {
      type: "book",
      title: "Bowling alone",
      subtitle: "the collapse and revival of American community",
      ISBN: "9780743203043",
      publisher: "Simon & Schuster",
      language: "en",
      author: [{ family: "Putnam", given: "Robert D." }],
    },
    from: { title: "k10plus" },
  },
];

export const OL_FALLBACK_ISBNS = ["9780743203043"];

export const LUHMANN_QUERY: TitleQuery = {
  title: "Soziale Systeme. Grundriß einer allgemeinen Theorie",
  firstAuthor: "Niklas Luhmann",
  year: 1984,
  type: "book",
};

/** What a header extractor may return when it only finds the main title. */
export const LUHMANN_SHORT_QUERY: TitleQuery = {
  title: "Soziale Systeme",
  firstAuthor: "Luhmann",
  year: 1984,
  type: "book",
};

export const TRAP_QUERIES: TitleQuery[] = [
  {
    title: "The Strength of Weak Ties",
    firstAuthor: "Granovetter",
    year: 1973,
    type: "article-journal",
  },
  {
    title: "Using thematic analysis in psychology",
    firstAuthor: "Braun",
    year: 2006,
    type: "article-journal",
  },
  {
    title: "Ethnicity, Insurgency, and Civil War",
    firstAuthor: "Fearon",
    year: 2003,
    type: "article-journal",
  },
];

export const ALL_INPUTS: string[] = CASES.map((c) => c.input);
