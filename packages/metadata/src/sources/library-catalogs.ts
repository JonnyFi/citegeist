import type { SourceRecord } from "../types.js";
import type { SourceContext } from "./context.js";
import { sruLookup } from "./marc.js";

/** DNB (Deutsche Nationalbibliothek) SRU, MARC21-xml, no key. German-language books. */
export function fetchDnb(ctx: SourceContext, isbn13: string): Promise<SourceRecord | undefined> {
  const url = new URL("https://services.dnb.de/sru/dnb");
  url.searchParams.set("version", "1.1");
  url.searchParams.set("operation", "searchRetrieve");
  url.searchParams.set("query", `num=${isbn13}`);
  url.searchParams.set("recordSchema", "MARC21-xml");
  url.searchParams.set("maximumRecords", "10");
  return sruLookup(ctx, { source: "dnb", isbn: isbn13, url: url.toString() });
}

/** K10plus (GBV and SWB union catalogue) SRU, marcxml. Carries all editors with GND ids. */
export function fetchK10plus(
  ctx: SourceContext,
  isbn13: string,
): Promise<SourceRecord | undefined> {
  const url = new URL("https://sru.k10plus.de/opac-de-627");
  url.searchParams.set("version", "1.1");
  url.searchParams.set("operation", "searchRetrieve");
  url.searchParams.set("query", `pica.isb=${isbn13}`);
  url.searchParams.set("recordSchema", "marcxml");
  url.searchParams.set("maximumRecords", "10");
  return sruLookup(ctx, { source: "k10plus", isbn: isbn13, url: url.toString() });
}
