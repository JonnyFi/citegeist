import type { EvalFixture } from "../types.js";
import type { MetadataFromFirstPageInput, MetadataFromFirstPageOutput } from "./index.js";

/** Every evidence string must occur in the page text (whitespace-insensitive). */
function evidenceFails(output: MetadataFromFirstPageOutput, text: string): string[] {
  const flat = (s: string) => s.replace(/\s+/g, " ").trim();
  const page = flat(text);
  const fails: string[] = [];
  for (const [field, p] of Object.entries(output)) {
    if (p && !page.includes(flat(p.evidence))) fails.push(`${field}: evidence not found on page`);
  }
  return fails;
}

const page1 = `Journal of Applied Memory Research
Vol. 12, No. 3, pp. 211-229, September 2021
https://doi.org/10.1234/jamr.2021.0042

Retrieval Practice in Older Adults: A Randomized Trial

Anna K. Berger and Tomas Lindqvist
Department of Psychology, University of Example

Abstract
We tested whether spaced retrieval practice improves recall in adults aged 65 and older. 131 participants were randomly assigned to practice or restudy conditions.`;

const page2 = `Niklas Luhmann
Soziale Systeme
Grundriß einer allgemeinen Theorie

Suhrkamp Verlag
Frankfurt am Main 1984`;

export const metadataFixtures: EvalFixture<
  MetadataFromFirstPageInput,
  MetadataFromFirstPageOutput
>[] = [
  {
    id: "journal-article",
    language: "en",
    input: { text: page1 },
    check: (o, i) => {
      const fails = evidenceFails(o, i.text);
      if (o.DOI?.value !== "10.1234/jamr.2021.0042") fails.push("DOI not proposed correctly");
      if (o.issued?.value?.slice(0, 4) !== "2021") fails.push("year not proposed correctly");
      if (!o.title?.value.startsWith("Retrieval Practice")) fails.push("title wrong");
      if ((o.author?.value.length ?? 0) !== 2) fails.push("expected two authors");
      return fails;
    },
  },
  {
    id: "book-title-page",
    language: "de",
    input: { text: page2 },
    check: (o, i) => {
      const fails = evidenceFails(o, i.text);
      if (o.DOI) fails.push("DOI proposed, but the page has none");
      if (o.author?.value[0]?.family !== "Luhmann") fails.push("author wrong");
      if (o.issued?.value !== "1984") fails.push("year wrong");
      return fails;
    },
  },
];
