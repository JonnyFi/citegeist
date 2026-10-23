import { documentsConfirmPages } from "@citegeist/ops";
import type { Pages } from "@citegeist/schema";
import { useId, useState } from "react";
import { useI18n } from "../i18n";
import { useOpMutation } from "../lib/hooks";
import { describeError } from "../lib/utils";
import { Button } from "./ui/button";

/**
 * One-time confirmation of the printed page numbers of a PDF. Page numbers in citations come from
 * here, so the reader checks them once; every card of the PDF follows the answer.
 */
export function PageBanner({ citekey, pages }: { citekey: string; pages: Pages }) {
  const { t } = useI18n();
  const confirm = useOpMutation(documentsConfirmPages);
  const pdfId = useId();
  const printedId = useId();
  const [pdfPage, setPdfPage] = useState(1);
  const labelOf = (page: number) => pages.pages[page - 1]?.label ?? "";
  const [printed, setPrinted] = useState<string | null>(null);

  const shown = printed ?? labelOf(pdfPage);
  const numeric = Number.parseInt(shown, 10);
  const changed = shown.trim() !== labelOf(pdfPage);
  // Only a changed numeric label means "shift everything"; confirming as shown sends no offset.
  const offset = changed && Number.isFinite(numeric) ? numeric - pdfPage : undefined;

  return (
    <section
      aria-label={t("pages.title")}
      className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line bg-accent-soft px-4 py-2 text-accent"
    >
      <span className="font-medium">{t("pages.title")}</span>
      <span className="flex flex-wrap items-center gap-1.5 text-ink">
        <label htmlFor={pdfId}>{t("pages.pdfPage")}</label>
        <input
          id={pdfId}
          type="number"
          min={1}
          max={pages.pages.length}
          value={pdfPage}
          onChange={(e) => {
            setPdfPage(Math.min(Math.max(Number(e.target.value) || 1, 1), pages.pages.length));
            setPrinted(null);
          }}
          className="h-7 w-16 border border-line bg-surface px-2"
        />
        <label htmlFor={printedId}>{t("pages.printedPage")}</label>
        <input
          id={printedId}
          value={shown}
          onChange={(e) => setPrinted(e.target.value)}
          className="h-7 w-20 border border-line bg-surface px-2"
        />
      </span>
      <Button
        size="sm"
        variant="primary"
        disabled={confirm.isPending || (changed && offset === undefined)}
        onClick={() =>
          confirm.mutate({
            citekey,
            source: pages.source,
            ...(offset !== undefined ? { offset } : {}),
          })
        }
      >
        {changed ? t("pages.correct") : t("pages.confirm")}
      </Button>
      {confirm.error ? (
        <span role="alert" className="text-danger">
          {describeError(confirm.error).message}
        </span>
      ) : null}
    </section>
  );
}
