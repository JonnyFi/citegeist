/** Inputs of the graph, retraction, version, PubMed and Unpaywall tests. Shared by the recorder and the tests. */

/** Wakefield et al. 1998, retracted by The Lancet in 2010, corrected in 2004. */
export const RETRACTED_DOI = "10.1016/s0140-6736(97)11096-0";
export const RETRACTED_PMID = "9500320";
/** A 1975 article: PubMed knows it, but it has no DOI. */
export const PMID_WITHOUT_DOI = "10";
/** Gold open access in Nature, no retraction. */
export const CLEAN_OA_DOI = "10.1038/s41586-020-2649-2";
/** Unpaywall says closed. */
export const CLOSED_DOI = "10.1191/1478088706qp063oa";
/** Registered at DataCite: Unpaywall answers 404. */
export const DATACITE_DOI = "10.5281/zenodo.12490189";
export const UNKNOWN_DOI = "10.9999/citegeist.unknown";

export const ARXIV_PREPRINT = "1706.03762";
/** ATLAS Higgs observation: the arXiv record names the published DOI. */
export const ARXIV_WITH_JOURNAL = "1207.7214";
export const ARXIV_PUBLISHED_DOI = "10.1016/j.physletb.2012.08.020";
/** Crossref relations in both directions. */
export const PREPRINT_DOI = "10.1364/opticaopen.29459153.v1";
export const PREPRINT_PUBLISHED_DOI = "10.1364/oe.572415";
export const PUBLISHED_WITH_PREPRINT_DOI = "10.1186/s13104-025-07626-0";
export const PREPRINT_OF_PUBLISHED_DOI = "10.21203/rs.3.rs-7773449/v1";
