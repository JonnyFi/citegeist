/** What a string typed or pasted into the add field looks like. The core makes the final call. */
export type IdentifierKind =
  | "doi"
  | "arxiv"
  | "isbn"
  | "pmid"
  | "url"
  | "bibtex"
  | "path"
  | "unknown";

const DOI = /^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)?(10\.\d{4,9}\/\S+)$/i;
const ARXIV =
  /^(?:arxiv:\s*|https?:\/\/arxiv\.org\/(?:abs|pdf)\/)?(\d{4}\.\d{4,5}(?:v\d+)?|[a-z-]+(?:\.[a-z]{2})?\/\d{7}(?:v\d+)?)(?:\.pdf)?$/i;
const PMID = /^pmid:?\s*(\d{1,9})$/i;

function isIsbn(value: string): boolean {
  const digits = value.replace(/^isbn(?:-1[03])?:?\s*/i, "").replace(/[- ]/g, "");
  return /^(?:\d{9}[\dxX]|97[89]\d{10})$/.test(digits);
}

export function classifyIdentifier(raw: string): { kind: IdentifierKind; value: string } {
  const value = raw.trim();
  if (!value) return { kind: "unknown", value };
  if (/^@\w+\s*\{/.test(value)) return { kind: "bibtex", value };
  if (
    /^(?:\/|~\/|[a-z]:\\|file:\/\/)/i.test(value) ||
    (/\.(?:pdf|epub|html?)$/i.test(value) && !/^https?:/i.test(value))
  ) {
    return { kind: "path", value };
  }
  if (DOI.test(value)) return { kind: "doi", value };
  if (ARXIV.test(value)) return { kind: "arxiv", value };
  if (PMID.test(value)) return { kind: "pmid", value };
  if (isIsbn(value)) return { kind: "isbn", value };
  if (/^https?:\/\//i.test(value)) return { kind: "url", value };
  return { kind: "unknown", value };
}
