import { asString } from "../csl.js";
import { cleanText, compact, dateFromText, splitPersonName } from "../text.js";
import { type Creator, type MetadataFields, SourceError, type SourceRecord } from "../types.js";
import { makeRecord, type SourceContext } from "./context.js";

type Json = Record<string, unknown>;

function names(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => asString((x as Json).name))
    .filter((n): n is string => !!n)
    .map((n) => cleanText(n));
}

/**
 * Open Library by ISBN, the fallback for books the library catalogues do not know. Its data is
 * user-contributed: editors are often listed as authors and dates may be reprint years.
 */
export async function fetchOpenLibrary(
  ctx: SourceContext,
  isbn13: string,
): Promise<SourceRecord | undefined> {
  const url = new URL("https://openlibrary.org/api/books");
  url.searchParams.set("bibkeys", `ISBN:${isbn13}`);
  url.searchParams.set("jscmd", "data");
  url.searchParams.set("format", "json");
  const res = await ctx.http.get({
    source: "openlibrary",
    url: url.toString(),
    accept: "application/json",
  });
  if (res.status === 404) return undefined;
  if (!res.ok) throw new SourceError("openlibrary", `HTTP ${res.status} for ${isbn13}`, res.status);
  let json: Record<string, Json>;
  try {
    json = JSON.parse(res.body) as Record<string, Json>;
  } catch {
    throw new SourceError("openlibrary", `response for ${isbn13} is not JSON`);
  }
  const book = json[`ISBN:${isbn13}`];
  if (!book) return undefined;
  return makeRecord("openlibrary", isbn13, res.fetchedAt, mapOpenLibrary(book, isbn13));
}

export function mapOpenLibrary(book: Json, isbn13: string): MetadataFields {
  const title = asString(book.title);
  const subtitle = asString(book.subtitle);
  const authors: Creator[] = names(book.authors).map((n) => splitPersonName(n));
  const identifiers = (book.identifiers ?? {}) as Record<string, unknown>;
  const olId = Array.isArray(identifiers.openlibrary)
    ? asString(identifiers.openlibrary[0])
    : undefined;
  const pages = typeof book.number_of_pages === "number" ? String(book.number_of_pages) : undefined;
  return compact<MetadataFields>({
    type: "book",
    title: title ? cleanText(title) : undefined,
    subtitle: subtitle ? cleanText(subtitle) : undefined,
    author: authors,
    issued: dateFromText(asString(book.publish_date)),
    publisher: names(book.publishers)[0],
    "publisher-place": names(book.publish_places)[0],
    ISBN: isbn13,
    "number-of-pages": pages,
    ids: compact<Record<string, string>>({ openlibrary: olId }),
  });
}
