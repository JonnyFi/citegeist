import type { MatrixCell, MatrixColumn } from "@citegeist/schema";
import { useState } from "react";
import { Stamp } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Textarea } from "../components/ui/input";
import { Star } from "../components/ui/provenance";
import { type MessageKey, useI18n } from "../i18n";
import { Evidence } from "./evidence";

const LINK_BUTTON = "text-[12px] text-muted underline-offset-2 hover:text-ink hover:underline";

/** One cell of the matrix: status, answer, evidence, provenance, and what can be done with it. */
export function MatrixCellView({
  citekey,
  itemLabel,
  column,
  cell,
  onFill,
  onSet,
  onClear,
}: {
  citekey: string;
  itemLabel: string;
  column: MatrixColumn;
  cell: MatrixCell;
  /** `force` replaces an answer that is already there. */
  onFill: (force: boolean) => void;
  onSet: (answer: string) => void;
  onClear: () => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<string | null>(null);
  const status = t(`matrix.status.${cell.status}` as MessageKey);
  const has = cell.status === "filled" || cell.status === "edited";
  const date = cell.provenance?.at.slice(0, 10) ?? "";

  const startEdit = () => setDraft(cell.answer);

  if (draft !== null) {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSet(draft);
          setDraft(null);
        }}
        className="flex flex-col gap-2"
      >
        <Textarea
          autoFocus
          rows={6}
          value={draft}
          aria-label={t("matrix.cell.answer", { item: itemLabel, column: column.name })}
          onChange={(e) => setDraft(e.target.value)}
          className="text-[13px] leading-[1.45]"
        />
        <div className="flex items-center gap-2">
          <Button type="submit" size="sm" variant="primary" disabled={draft.trim() === ""}>
            {t("matrix.cell.save")}
          </Button>
          <Button type="button" size="sm" onClick={() => setDraft(null)}>
            {t("common.cancel")}
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {cell.status === "filling" ? (
        <p role="status" className="flex items-center gap-2 italic text-muted">
          <span aria-hidden="true" className="size-2 animate-pulse bg-agent" />
          {status}
        </p>
      ) : null}

      {has ? (
        <p className="whitespace-pre-wrap leading-[1.45]">{cell.answer}</p>
      ) : cell.status === "failed" ? (
        <div className="flex flex-col gap-1">
          <span>
            <Stamp tone="danger">{status}</Stamp>
          </span>
          {cell.error ? <p className="text-[12px] text-danger">{cell.error}</p> : null}
        </div>
      ) : cell.status === "empty" ? (
        <p className="text-muted">{status}</p>
      ) : null}

      {has ? <Evidence citekey={citekey} evidence={cell.evidence} /> : null}

      {has ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted">
          {cell.status === "edited" ? <Stamp>{status}</Stamp> : <span>{status}</span>}
          {cell.provenance?.source === "model" ? (
            <span className="inline-flex items-center gap-1.5">
              <Star />
              <span className="font-mono">
                {t("matrix.cell.byModel", {
                  model: cell.provenance.model ?? cell.provenance.by,
                  date,
                })}
              </span>
            </span>
          ) : cell.provenance ? (
            <span className="font-mono">{t("matrix.cell.byHuman", { date })}</span>
          ) : null}
        </div>
      ) : null}

      {cell.status !== "filling" ? (
        <fieldset className="m-0 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 border-0 p-0">
          <legend className="sr-only">
            {t("matrix.cell.actions", { item: itemLabel, column: column.name })}
          </legend>
          {cell.status === "empty" ? (
            <>
              <Button
                size="sm"
                aria-label={`${t("matrix.cell.fill")}: ${itemLabel}, ${column.name}`}
                onClick={() => onFill(false)}
              >
                {t("matrix.cell.fill")}
              </Button>
              <button type="button" className={LINK_BUTTON} onClick={startEdit}>
                {t("matrix.cell.write")}
              </button>
            </>
          ) : null}
          {cell.status === "failed" ? (
            <Button size="sm" onClick={() => onFill(false)}>
              {t("matrix.cell.retry")}
            </Button>
          ) : null}
          {has ? (
            <>
              <button type="button" className={LINK_BUTTON} onClick={startEdit}>
                {t("matrix.cell.edit")}
              </button>
              <button type="button" className={LINK_BUTTON} onClick={() => onFill(true)}>
                {t("matrix.cell.refill")}
              </button>
              <button type="button" className={LINK_BUTTON} onClick={onClear}>
                {t("matrix.cell.clear")}
              </button>
            </>
          ) : null}
        </fieldset>
      ) : null}
    </div>
  );
}
