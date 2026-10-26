import { itemsAdd } from "@citegeist/ops";
import { useI18n } from "../i18n";
import { useOpMutation } from "../lib/hooks";
import { describeError } from "../lib/utils";
import { Button } from "./ui/button";

/**
 * The sample paper of an empty library: the Docling Technical Report (CC-BY 4.0), addressed by
 * its arXiv id so that it downloads when the person asks. The PDF is not part of the app. A test
 * checks the id against fixtures/pdf/manifest.json.
 */
export const SAMPLE_IDENTIFIER = "arXiv:2408.09869";

/** What an empty library shows: the three first actions and a button that adds a sample paper. */
export function FirstSteps() {
  const { t } = useI18n();
  const add = useOpMutation(itemsAdd);
  const steps = [
    ["first.add.title", "first.add.desc"],
    ["first.highlight.title", "first.highlight.desc"],
    ["first.chat.title", "first.chat.desc"],
  ] as const;

  return (
    <div
      data-testid="first-steps"
      className="flex max-w-[640px] flex-col items-start gap-3 px-8 py-6"
    >
      <h2 className="font-serif text-[20px] font-medium leading-tight">{t("first.title")}</h2>
      <p className="leading-[1.5] text-muted">{t("first.intro")}</p>
      <ol className="flex flex-col gap-3">
        {steps.map(([title, description], i) => (
          <li key={title} className="flex gap-3">
            <span
              aria-hidden="true"
              className="mt-0.5 flex size-5 shrink-0 items-center justify-center border border-line font-mono text-[11px]"
            >
              {i + 1}
            </span>
            <div>
              <p className="font-medium">{t(title)}</p>
              <p className="leading-[1.5] text-muted">{t(description)}</p>
            </div>
          </li>
        ))}
      </ol>
      <div className="mt-2 flex flex-col items-start gap-2 border-t border-line pt-4">
        <div className="flex items-center gap-3">
          <Button
            variant="primary"
            disabled={add.isPending}
            onClick={() => add.mutate({ identifier: SAMPLE_IDENTIFIER, target: "library" })}
          >
            {add.isPending ? t("first.sample.adding") : t("first.sample.button")}
          </Button>
        </div>
        <p className="text-sm text-muted">{t("first.sample.desc")}</p>
        {add.isError ? (
          <p role="alert" className="text-sm text-danger">
            {t("first.sample.error", { message: describeError(add.error).message })}
          </p>
        ) : null}
      </div>
    </div>
  );
}
