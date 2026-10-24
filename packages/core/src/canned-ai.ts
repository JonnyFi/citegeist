import { type InferenceBackend, MockBackend } from "@citegeist/ai";

export const CANNED_PARAPHRASE = "Canned paraphrase of the selected passage.";
export const CANNED_KIND = "finding" as const;

/**
 * A backend that answers every task with fixed texts. End-to-end runs use it to exercise the
 * whole card flow without a subscription or an API key (desktop core: `CITEGEIST_AI_MOCK=1`).
 */
export function cannedAiBackend(id = "mock"): InferenceBackend {
  return new MockBackend(
    {
      "card.paraphrase": { paraphrase: CANNED_PARAPHRASE, kind: CANNED_KIND },
      "card.verify": { faithful: true, issues: [] },
    },
    id,
  );
}
