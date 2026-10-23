import { z } from "zod";
import { defineTask } from "../types.js";
import { PROMPT_VERSION, prompt, system } from "./prompt.v1.js";

export const CardVerifyInput = z.object({
  passage: z.string().min(1),
  paraphrase: z.string().min(1),
  core: z.string().min(1),
});
export type CardVerifyInput = z.infer<typeof CardVerifyInput>;

export const VerifyIssueKind = z.enum(["added", "distorted", "hedge-lost", "number-mismatch"]);

export const CardVerifyOutput = z.object({
  faithful: z.boolean(),
  issues: z.array(z.object({ kind: VerifyIssueKind, detail: z.string().min(1) })),
});
export type CardVerifyOutput = z.infer<typeof CardVerifyOutput>;

const passage =
  "In the pilot, 24 of 60 patients (40 percent) reported less pain after four weeks. The effect was not significant against placebo, and the authors call the result preliminary.";

export const cardVerify = defineTask({
  name: "card.verify",
  promptVersion: PROMPT_VERSION,
  description: "Judges whether a paraphrase and core statement stay faithful to the passage.",
  input: CardVerifyInput,
  output: CardVerifyOutput,
  modelClass: "smart",
  system,
  prompt,
  fixtures: [
    {
      id: "faithful",
      language: "en",
      input: {
        passage,
        paraphrase:
          "Forty percent of the 60 pilot patients, 24 in all, had less pain after four weeks. Against placebo the difference was not significant, and the authors treat the finding as preliminary.",
        core: "A small pilot found less pain in 40 percent of patients, but not significantly better than placebo.",
      },
      check: (o) => (o.faithful ? [] : [`judged unfaithful: ${JSON.stringify(o.issues)}`]),
    },
    {
      id: "invented-claim-and-lost-hedge",
      language: "en",
      input: {
        passage,
        paraphrase:
          "Forty percent of the 60 pilot patients had less pain after four weeks because the drug lowers inflammation, which proves the treatment works.",
        core: "The treatment reduces pain.",
      },
      check: (o) =>
        o.faithful ? ["judged faithful, but the paraphrase adds a cause and drops the hedge"] : [],
    },
  ],
});
