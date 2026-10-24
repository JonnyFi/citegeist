import type { CardKind } from "@citegeist/schema";
import { inventedNumbers, isWrittenIn, longestSharedRun, wordCount } from "../checks.js";
import type { EvalFixture } from "../types.js";
import type { CardParaphraseInput, CardParaphraseOutput } from "./index.js";

/** Sentences end at . ! or ? before a space and a capital letter, so "0,48" and "e.g." stay whole. */
export function sentenceCount(text: string): number {
  const ends = text.trim().match(/[.!?]+(?=\s+[\p{Lu}"„“»(]|\s*$)/gu);
  return ends?.length ?? 0;
}

function check(
  output: CardParaphraseOutput,
  input: CardParaphraseInput,
  language: string,
  kinds: readonly CardKind[],
): string[] {
  const fails: string[] = [];
  if (!isWrittenIn(language, output.paraphrase)) fails.push(`paraphrase is not in ${language}`);
  const invented = inventedNumbers(input.passage, output.paraphrase);
  if (invented.length) fails.push(`numbers not in passage: ${invented.join(", ")}`);
  const run = longestSharedRun(input.passage, output.paraphrase);
  if (run >= 12) fails.push(`paraphrase copies a run of ${run} words`);
  if (wordCount(output.paraphrase) > wordCount(input.passage) * 1.4) {
    fails.push("paraphrase is much longer than the passage");
  }
  const sentences = sentenceCount(output.paraphrase);
  if (sentences < 1 || sentences > 3)
    fails.push(`paraphrase has ${sentences} sentences, not 1 to 3`);
  if (!kinds.includes(output.kind)) {
    fails.push(`kind is ${output.kind}, expected ${kinds.join(" or ")}`);
  }
  return fails;
}

/** `kinds` lists the kinds a careful reader would accept for the passage. */
const cases: { id: string; language: string; kinds: CardKind[]; passage: string }[] = [
  {
    id: "en-sleep-memory",
    language: "de",
    kinds: ["finding", "critique"],
    passage:
      "Sleep-dependent memory consolidation is often described as a transfer from hippocampus to neocortex, but the evidence is more mixed than this picture suggests. In rodents, hippocampal sharp-wave ripples coincide with the replay of recently traversed paths, and disrupting them impairs later performance on spatial tasks. In humans, the effects are moderate and depend strongly on the material: declarative word-pair learning shows reliable gains after a night of sleep, whereas procedural skills improve mainly when learners have practiced enough before sleeping.",
  },
  {
    id: "de-institutionen",
    language: "en",
    kinds: ["thesis"],
    passage:
      "Institutionen entlasten das Handeln, indem sie Erwartungen verfestigen. Wer in einer Behörde einen Antrag stellt, muss nicht jedes Mal neu aushandeln, welche Unterlagen gelten und wer zuständig ist. Diese Entlastung hat jedoch einen Preis: Was einmal eingespielt ist, wird selten hinterfragt, und Abweichungen werden eher als Störung denn als Lernchance wahrgenommen. Die neuere Organisationssoziologie spricht deshalb von einer Spannung zwischen Stabilität und Anpassungsfähigkeit, die sich in der Praxis kaum auflösen lässt.",
  },
  {
    id: "en-survey-response",
    language: "en",
    kinds: ["finding", "critique"],
    passage:
      "Across the 14 panel waves, response rates fell from 61 percent in the first wave to 38 percent in the last. Attrition was not random: respondents with lower incomes and less formal education left earlier, which may bias estimates of mobility upward. The authors reweight the data using inverse probability weights, but they note that the weights rely on observed characteristics only and cannot correct for dropout driven by unobserved factors.",
  },
  {
    id: "de-lernen-feedback",
    language: "de",
    kinds: ["finding"],
    passage:
      "In der Metaanalyse über 435 Studien lag die mittlere Effektstärke von Feedback bei 0,48. Entscheidend war weniger, ob Feedback gegeben wurde, als wie: Rückmeldungen, die sich auf die Aufgabe und den nächsten Schritt bezogen, wirkten deutlich stärker als Lob für die Person. In einigen Studien verschlechterte Feedback sogar die Leistung, vor allem dann, wenn es als Kontrolle erlebt wurde. Die Autoren warnen davor, den Mittelwert als Handlungsanweisung zu lesen, weil die Streuung zwischen den Studien groß ist.",
  },
  {
    id: "en-method-sampling",
    language: "de",
    kinds: ["method"],
    passage:
      "We recruited participants through three community centers between March and June. Eligibility required age 65 or older and no formal dementia diagnosis. Of 212 people approached, 143 agreed to take part, and 131 completed both sessions. Because recruitment relied on centers that offer organized activities, the sample probably over-represents socially active older adults, and the findings should not be generalized to people who are isolated or housebound.",
  },
  {
    id: "en-definition-social-capital",
    language: "de",
    kinds: ["definition"],
    passage:
      "By social capital we mean the resources that an actor can draw on through durable relationships of mutual acquaintance and recognition. The term does not cover the relationships themselves, but what they make available: information, favors, introductions and the expectation of reciprocity. Two people with the same number of contacts can therefore hold very different amounts of social capital.",
  },
  {
    id: "de-beispiel-hafen",
    language: "en",
    kinds: ["example"],
    passage:
      "Ein Beispiel dafür liefert der Hafen von Rotterdam. Als dort in den 1980er Jahren die Containerumschlagsanlagen automatisiert wurden, gingen zunächst Arbeitsplätze verloren, doch die Hafenbehörde richtete gemeinsam mit den Gewerkschaften ein Umschulungsprogramm ein. Ein Teil der Beschäftigten arbeitete danach in der Steuerung der neuen Anlagen.",
  },
  {
    id: "en-critique-metrics",
    language: "de",
    kinds: ["critique"],
    passage:
      "The difficulty with citation counts as a measure of quality is that they record attention, not correctness. A paper that is widely cited because it is wrong, or because it is a convenient target, scores as well as a paper that is cited because it is right. Rankings built on such counts therefore reward visibility, and they invite exactly the behavior that they claim to measure, namely self-citation and citation rings.",
  },
  {
    id: "de-these-arbeit",
    language: "en",
    kinds: ["thesis"],
    passage:
      "Wir vertreten die These, dass die Erwerbsarbeit ihre Rolle als Quelle sozialer Anerkennung nicht verliert, sondern mit neuen Formen der Selbstdarstellung verbindet. Wer sichtbar beschäftigt ist, gilt als zugehörig, und wer es nicht ist, muss sich erklären. Dieser Zusammenhang, so unser Argument, erklärt auch, warum Arbeitszeitverkürzungen politisch schwerer durchzusetzen sind als es die Umfragen zu den Wünschen der Beschäftigten vermuten lassen.",
  },
];

export const cardParaphraseFixtures: EvalFixture<CardParaphraseInput, CardParaphraseOutput>[] =
  cases.map((c) => ({
    id: c.id,
    input: { passage: c.passage },
    language: c.language,
    check: (output, input) => check(output, input, c.language, c.kinds),
  }));
