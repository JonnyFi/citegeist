import { itemsList, matrixCreate } from "@citegeist/ops";
import { Plus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Label } from "../components/layout";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { ErrorState, Loading } from "../components/ui/states";
import { type MessageKey, useI18n } from "../i18n";
import { useOp, useOpMutation } from "../lib/hooks";
import { describeError } from "../lib/utils";
import { useLibraryLinks } from "../notes/library-links";
import { rowLabel } from "./model";

interface Draft {
  key: number;
  name: string;
  instruction: string;
}

const PRESETS = ["question", "method", "finding"] as const;

/** Form that makes a matrix from the sources of the project and the questions put to them. */
export function CreateMatrix({
  project,
  onCreated,
  onCancel,
}: {
  project: string;
  onCreated: (id: string) => void;
  onCancel?: (() => void) | undefined;
}) {
  const { t } = useI18n();
  const items = useOp(itemsList, { project, inbox: false, limit: 500 });
  const { index } = useLibraryLinks();
  const create = useOpMutation(matrixCreate);
  const [title, setTitle] = useState(t("matrix.create.defaultName"));
  const [picked, setPicked] = useState<ReadonlySet<string> | null>(null);
  const [columns, setColumns] = useState<Draft[]>([{ key: 1, name: "", instruction: "" }]);
  const [next, setNext] = useState(2);

  const all = items.data?.items.map((i) => i.citekey) ?? [];
  // every source of the project is chosen until the person changes the choice
  const chosen = picked ?? new Set(all);
  useEffect(() => {
    if (picked === null && all.length > 0) setPicked(new Set(all));
  }, [all, picked]);

  const named = columns.filter((c) => c.name.trim());
  const addColumn = (name = "", instruction = "") => {
    setColumns((prev) => {
      const onlyEmpty = prev.length === 1 && !prev[0]?.name.trim();
      return [...(onlyEmpty ? [] : prev), { key: next, name, instruction }];
    });
    setNext((n) => n + 1);
  };
  const patch = (key: number, change: Partial<Draft>) =>
    setColumns((prev) => prev.map((c) => (c.key === key ? { ...c, ...change } : c)));

  if (items.isPending) return <Loading label={t("matrix.loading")} />;
  if (items.isError) return <ErrorState error={items.error} />;

  return (
    <form
      aria-label={t("matrix.create.title")}
      onSubmit={(e) => {
        e.preventDefault();
        if (!title.trim() || named.length === 0) return;
        create.mutate(
          {
            project,
            title: title.trim(),
            columns: named.map((c) => ({ name: c.name.trim(), instruction: c.instruction.trim() })),
            items: all.filter((k) => chosen.has(k)),
          },
          { onSuccess: (out) => onCreated(out.matrix.id) },
        );
      }}
      className="min-h-0 flex-1 overflow-y-auto px-8 pb-10 pt-8"
    >
      <div className="flex max-w-[680px] flex-col gap-6">
        <h2 className="font-serif text-[24px] font-medium leading-tight">
          {t("matrix.create.title")}
        </h2>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="matrix-title">
            <Label>{t("matrix.create.name")}</Label>
          </label>
          <Input id="matrix-title" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>

        <fieldset className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <legend>
              <Label>{t("matrix.create.items")}</Label>
            </legend>
            <div className="flex gap-3 text-[12px]">
              <button
                type="button"
                className="text-muted underline-offset-2 hover:text-ink hover:underline"
                onClick={() => setPicked(new Set(all))}
              >
                {t("matrix.create.selectAll")}
              </button>
              <button
                type="button"
                className="text-muted underline-offset-2 hover:text-ink hover:underline"
                onClick={() => setPicked(new Set())}
              >
                {t("matrix.create.selectNone")}
              </button>
            </div>
          </div>
          {all.length === 0 ? (
            <p className="text-muted">{t("matrix.create.itemsNone")}</p>
          ) : (
            <ul className="flex max-h-60 flex-col overflow-y-auto border border-line">
              {all.map((citekey) => {
                const item = index?.items.get(citekey);
                const summary = items.data.items.find((i) => i.citekey === citekey);
                return (
                  <li key={citekey} className="border-b border-line-soft last:border-b-0">
                    <label className="flex min-h-10 cursor-default items-center gap-3 px-3 py-1.5 hover:bg-sunken">
                      <input
                        type="checkbox"
                        checked={chosen.has(citekey)}
                        onChange={(e) => {
                          const copy = new Set(chosen);
                          if (e.target.checked) copy.add(citekey);
                          else copy.delete(citekey);
                          setPicked(copy);
                        }}
                        className="size-4 shrink-0 accent-ink"
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {summary?.title ?? item?.title ?? citekey}
                      </span>
                      <span className="shrink-0 font-mono text-[11px] text-muted">
                        {rowLabel(summary ?? item) || citekey}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </fieldset>

        <fieldset className="flex flex-col gap-3">
          <legend>
            <Label>{t("matrix.create.columns")}</Label>
          </legend>
          <ul className="flex flex-col gap-3">
            {columns.map((c, i) => (
              <li
                key={c.key}
                className="grid grid-cols-[200px_minmax(0,1fr)_28px] items-start gap-2"
              >
                <Input
                  aria-label={`${t("matrix.create.columnName")} ${i + 1}`}
                  value={c.name}
                  onChange={(e) => patch(c.key, { name: e.target.value })}
                />
                <Input
                  aria-label={`${t("matrix.create.columnInstruction")} ${i + 1}`}
                  value={c.instruction}
                  placeholder={t("matrix.create.columnInstruction")}
                  onChange={(e) => patch(c.key, { instruction: e.target.value })}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`${t("matrix.create.removeColumn")} ${i + 1}`}
                  disabled={columns.length === 1}
                  onClick={() => setColumns((prev) => prev.filter((x) => x.key !== c.key))}
                >
                  <X className="size-3.5" />
                </Button>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" onClick={() => addColumn()}>
              <Plus className="size-3.5" />
              {t("matrix.create.addColumn")}
            </Button>
            <span className="text-[12px] text-muted">{t("matrix.create.presets")}</span>
            {PRESETS.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() =>
                  addColumn(
                    t(`matrix.preset.${id}.name` as MessageKey),
                    t(`matrix.preset.${id}.instruction` as MessageKey),
                  )
                }
                className="border border-line-faint px-2 py-[3px] text-[12px] hover:bg-sunken"
              >
                {t(`matrix.preset.${id}.name` as MessageKey)}
              </button>
            ))}
          </div>
        </fieldset>

        <div className="flex items-center gap-2">
          <Button
            type="submit"
            variant="primary"
            disabled={create.isPending || !title.trim() || named.length === 0}
          >
            {t("matrix.create.submit")}
          </Button>
          {onCancel ? (
            <Button type="button" onClick={onCancel}>
              {t("common.cancel")}
            </Button>
          ) : null}
          {create.error ? (
            <span role="alert" className="text-danger">
              {describeError(create.error).message}
            </span>
          ) : null}
        </div>
      </div>
    </form>
  );
}
