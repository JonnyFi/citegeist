import { inventedNumbers, isWrittenIn, longestSharedRun, wordCount } from "../checks.js";
import type { EvalFixture } from "../types.js";
import type { CardParaphraseInput, CardParaphraseOutput } from "./index.js";

function check(
  output: CardParaphraseOutput,
  input: CardParaphraseInput,
  language: string,
): string[] {
  const fails: string[] = [];
  if (!isWrittenIn(language, output.paraphrase)) fails.push(`paraphrase is not in ${language}`);
  if (!isWrittenIn(language, output.core)) fails.push(`core is not in ${language}`);
  const invented = inventedNumbers(input.passage, `${output.paraphrase} ${output.core}`);
  if (invented.length) fails.push(`numbers not in passage: ${invented.join(", ")}`);
  const run = longestSharedRun(input.passage, output.paraphrase);
  if (run >= 12) fails.push(`paraphrase copies a run of ${run} words`);
  if (wordCount(output.paraphrase) > wordCount(input.passage) * 1.4) {
    fails.push("paraphrase is much longer than the passage");
  }
  if (wordCount(output.core) > wordCount(output.paraphrase)) {
    fails.push("core is longer than the paraphrase");
  }
  return fails;
}

const cases: { id: string; language: string; passage: string }[] = [
  {
    id: "en-sleep-memory",
    language: "de",
    passage:
      "Sleep-dependent memory consolidation is often described as a transfer from hippocampus to neocortex, but the evidence is more mixed than this picture suggests. In rodents, hippocampal sharp-wave ripples coincide with the replay of recently traversed paths, and disrupting them impairs later performance on spatial tasks. In humans, the effects are moderate and depend strongly on the material: declarative word-pair learning shows reliable gains after a night of sleep, whereas procedural skills improve mainly when learners have practiced enough before sleeping.",
  },
  {
    id: "de-institutionen",
    language: "en",
    passage:
      "Institutionen entlasten das Handeln, indem sie Erwartungen verfestigen. Wer in einer Behörde einen Antrag stellt, muss nicht jedes Mal neu aushandeln, welche Unterlagen gelten und wer zuständig ist. Diese Entlastung hat jedoch einen Preis: Was einmal eingespielt ist, wird selten hinterfragt, und Abweichungen werden eher als Störung denn als Lernchance wahrgenommen. Die neuere Organisationssoziologie spricht deshalb von einer Spannung zwischen Stabilität und Anpassungsfähigkeit, die sich in der Praxis kaum auflösen lässt.",
  },
  {
    id: "en-survey-response",
    language: "en",
    passage:
      "Across the 14 panel waves, response rates fell from 61 percent in the first wave to 38 percent in the last. Attrition was not random: respondents with lower incomes and less formal education left earlier, which may bias estimates of mobility upward. The authors reweight the data using inverse probability weights, but they note that the weights rely on observed characteristics only and cannot correct for dropout driven by unobserved factors.",
  },
  {
    id: "de-lernen-feedback",
    language: "de",
    passage:
      "In der Metaanalyse über 435 Studien lag die mittlere Effektstärke von Feedback bei 0,48. Entscheidend war weniger, ob Feedback gegeben wurde, als wie: Rückmeldungen, die sich auf die Aufgabe und den nächsten Schritt bezogen, wirkten deutlich stärker als Lob für die Person. In einigen Studien verschlechterte Feedback sogar die Leistung, vor allem dann, wenn es als Kontrolle erlebt wurde. Die Autoren warnen davor, den Mittelwert als Handlungsanweisung zu lesen, weil die Streuung zwischen den Studien groß ist.",
  },
  {
    id: "en-method-sampling",
    language: "de",
    passage:
      "We recruited participants through three community centers between March and June. Eligibility required age 65 or older and no formal dementia diagnosis. Of 212 people approached, 143 agreed to take part, and 131 completed both sessions. Because recruitment relied on centers that offer organized activities, the sample probably over-represents socially active older adults, and the findings should not be generalized to people who are isolated or housebound.",
  },
];

export const cardParaphraseFixtures: EvalFixture<CardParaphraseInput, CardParaphraseOutput>[] =
  cases.map((c) => ({
    id: c.id,
    input: { passage: c.passage },
    language: c.language,
    check: (output, input) => check(output, input, c.language),
  }));
