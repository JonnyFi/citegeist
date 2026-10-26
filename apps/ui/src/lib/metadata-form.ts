import type { Creator, ItemFrontmatter } from "@citegeist/schema";

/**
 * The metadata form of the item view: from the item to form values, validation with German
 * messages (as message keys), and back to the patch that items.update takes. Only fields that
 * changed go into the patch, so that a save does not mark untouched fields as edited by hand.
 */

export interface CreatorRow {
  kind: "person" | "org";
  family: string;
  given: string;
  /** The creator this row came from, kept when the row is not changed (ORCID, particles). */
  original?: Creator;
}

export interface MetadataForm {
  type: string;
  title: string;
  authors: CreatorRow[];
  editors: CreatorRow[];
  issued: string;
  containerTitle: string;
  volume: string;
  issue: string;
  page: string;
  publisher: string;
  place: string;
  edition: string;
  doi: string;
  isbn: string;
  url: string;
  abstract: string;
  language: string;
}

export type FormErrors = Partial<Record<keyof MetadataForm, FormErrorKey>>;

export type FormErrorKey =
  | "metaform.error.title"
  | "metaform.error.doi"
  | "metaform.error.isbn"
  | "metaform.error.url"
  | "metaform.error.issued"
  | "metaform.error.language"
  | "metaform.error.creator";

export function isValidDoi(value: string): boolean {
  return normalizeDoi(value) !== undefined;
}

/** A DOI without prefix in lower case, or undefined when the text is no DOI. */
export function normalizeDoi(value: string): string | undefined {
  const s = value
    .trim()
    .replace(/^(?:https?:\/\/)?(?:dx\.)?doi\.org\//i, "")
    .replace(/^(?:doi|urn:doi|info:doi)[:/]?\s*/i, "");
  return /^10\.\d{4,9}\/\S+$/.test(s) ? s.toLowerCase() : undefined;
}

function isbnDigits(value: string): string {
  return value.replace(/[\s‐-―-]/g, "").toUpperCase();
}

/** ISBN-10 or ISBN-13 with a correct check digit. */
export function isValidIsbn(value: string): boolean {
  const s = isbnDigits(value.replace(/^isbn(?:-1[03])?:?\s*/i, ""));
  if (/^\d{13}$/.test(s)) {
    if (!/^97[89]/.test(s)) return false;
    let sum = 0;
    for (let i = 0; i < 13; i++) sum += Number(s[i]) * (i % 2 === 0 ? 1 : 3);
    return sum % 10 === 0;
  }
  if (/^\d{9}[\dX]$/.test(s)) {
    let sum = 0;
    for (let i = 0; i < 10; i++) sum += (s[i] === "X" ? 10 : Number(s[i])) * (10 - i);
    return sum % 11 === 0;
  }
  return false;
}

/** Several ISBNs are separated by commas or semicolons; each must be valid. */
export function isValidIsbnList(value: string): boolean {
  const tokens = value
    .split(/[,;]/)
    .map((t) => t.trim())
    .filter(Boolean);
  return tokens.length > 0 && tokens.every(isValidIsbn);
}

function isHttpUrl(value: string): boolean {
  try {
    return /^https?:$/.test(new URL(value).protocol);
  } catch {
    return false;
  }
}

const DATE = /^-?\d{1,4}(?:-(0[1-9]|1[0-2])(?:-(0[1-9]|[12]\d|3[01]))?)?$/;

function rowOf(c: Creator): CreatorRow {
  return "family" in c
    ? { kind: "person", family: c.family, given: c.given ?? "", original: c }
    : { kind: "org", family: c.literal, given: "", original: c };
}

function text(v: unknown): string {
  return v === undefined || v === null ? "" : String(v);
}

export function formFromItem(fm: ItemFrontmatter): MetadataForm {
  const extra = fm as Record<string, unknown>;
  return {
    type: fm.type,
    title: fm.title,
    authors: (fm.author ?? []).map(rowOf),
    editors: (fm.editor ?? []).map(rowOf),
    issued: text(fm.issued),
    containerTitle: text(fm["container-title"]),
    volume: text(fm.volume),
    issue: text(fm.issue),
    page: text(fm.page),
    publisher: text(fm.publisher),
    place: text(fm["publisher-place"]),
    edition: text(extra.edition),
    doi: text(fm.DOI),
    isbn: text(fm.ISBN),
    url: text(fm.URL),
    abstract: text(fm.abstract),
    language: text(fm.language),
  };
}

export function emptyRow(): CreatorRow {
  return { kind: "person", family: "", given: "" };
}

/** A row the user left empty is dropped when saving. */
function isBlank(r: CreatorRow): boolean {
  return r.family.trim() === "" && r.given.trim() === "";
}

function toCreator(r: CreatorRow): Creator {
  const family = r.family.trim();
  const given = r.given.trim();
  const o = r.original;
  if (o) {
    if ("family" in o && r.kind === "person" && o.family === family && (o.given ?? "") === given) {
      return o;
    }
    if ("literal" in o && r.kind === "org" && o.literal === family) return o;
  }
  if (r.kind === "org") return { literal: family };
  return given ? { family, given } : { family };
}

export function validateForm(form: MetadataForm): FormErrors {
  const errors: FormErrors = {};
  if (form.title.trim() === "") errors.title = "metaform.error.title";
  if (form.doi.trim() !== "" && !isValidDoi(form.doi)) errors.doi = "metaform.error.doi";
  if (form.isbn.trim() !== "" && !isValidIsbnList(form.isbn)) errors.isbn = "metaform.error.isbn";
  if (form.url.trim() !== "" && !isHttpUrl(form.url.trim())) errors.url = "metaform.error.url";
  if (form.issued.trim() !== "" && !DATE.test(form.issued.trim())) {
    errors.issued = "metaform.error.issued";
  }
  if (
    form.language.trim() !== "" &&
    !/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(form.language.trim())
  ) {
    errors.language = "metaform.error.language";
  }
  // a person needs a family name; given name alone is no name
  const bad = [...form.authors, ...form.editors].some((r) => !isBlank(r) && r.family.trim() === "");
  if (bad) errors.authors = "metaform.error.creator";
  return errors;
}

function creators(rows: CreatorRow[]): Creator[] {
  return rows.filter((r) => !isBlank(r)).map(toCreator);
}

/** The year alone is stored as a number, like the lookups do. */
function issuedValue(s: string): number | string {
  const t = s.trim();
  return /^\d{4}$/.test(t) ? Number(t) : t;
}

/** The fields that differ from the item, as an items.update patch. Empty values remove a field. */
export function patchFromForm(form: MetadataForm, fm: ItemFrontmatter): Record<string, unknown> {
  const old = formFromItem(fm);
  const patch: Record<string, unknown> = {};
  const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
  const str = (key: string, now: string, before: string, normalize?: (s: string) => string) => {
    if (now.trim() === before.trim()) return;
    patch[key] = now.trim() === "" ? null : normalize ? normalize(now.trim()) : now.trim();
  };
  str("title", form.title, old.title);
  if (form.type !== old.type) patch.type = form.type;
  const authors = creators(form.authors);
  if (!same(authors, creators(old.authors))) patch.author = authors.length > 0 ? authors : null;
  const editors = creators(form.editors);
  if (!same(editors, creators(old.editors))) patch.editor = editors.length > 0 ? editors : null;
  if (form.issued.trim() !== old.issued.trim()) {
    patch.issued = form.issued.trim() === "" ? null : issuedValue(form.issued);
  }
  str("container-title", form.containerTitle, old.containerTitle);
  str("volume", form.volume, old.volume);
  str("issue", form.issue, old.issue);
  str("page", form.page, old.page);
  str("publisher", form.publisher, old.publisher);
  str("publisher-place", form.place, old.place);
  str("edition", form.edition, old.edition);
  str("DOI", form.doi, old.doi, (s) => normalizeDoi(s) ?? s);
  str("ISBN", form.isbn, old.isbn, (s) =>
    s
      .split(/[,;]/)
      .map((t) => t.trim())
      .filter(Boolean)
      .join(", "),
  );
  str("URL", form.url, old.url);
  str("abstract", form.abstract, old.abstract);
  str("language", form.language, old.language);
  return patch;
}

/** True when the item has no author or editor, or no date: what the library list marks. */
export function hasThinMetadata(fm: {
  author?: unknown[] | undefined;
  editor?: unknown[] | undefined;
  issued?: unknown;
}): boolean {
  return (
    ((fm.author?.length ?? 0) === 0 && (fm.editor?.length ?? 0) === 0) || fm.issued === undefined
  );
}
