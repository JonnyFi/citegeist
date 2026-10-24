import type { NumberedNode } from "@citegeist/ops";
import { useEffect, useId, useState } from "react";
import { Label } from "../components/layout";
import { Input } from "../components/ui/input";
import { Segmented } from "../components/ui/segmented";
import { useI18n } from "../i18n";
import { cn } from "../lib/utils";
import { STATUS_ORDER } from "./outline";

export type NodePatch = Partial<{
  title: string;
  purpose: string | null;
  status: NumberedNode["status"];
  questions: string[];
}>;

/**
 * Title, purpose, status and research questions of the open node, above its document. Text fields
 * save when they lose focus; status and questions save at once.
 */
export function NodeForm({
  node,
  questions,
  onPatch,
}: {
  node: NumberedNode;
  questions: ReadonlyArray<{ id: string; text: string }>;
  onPatch: (patch: NodePatch) => void;
}) {
  const { t } = useI18n();
  const purposeId = useId();
  const [title, setTitle] = useState(node.title);
  const [purpose, setPurpose] = useState(node.purpose ?? "");

  // follow the stored values when they change from outside (the agent, another window)
  useEffect(() => setTitle(node.title), [node.title]);
  useEffect(() => setPurpose(node.purpose ?? ""), [node.purpose]);

  const saveTitle = () => {
    const next = title.trim();
    if (!next) setTitle(node.title);
    else if (next !== node.title) onPatch({ title: next });
  };
  const savePurpose = () => {
    const next = purpose.trim();
    if (next !== (node.purpose ?? "")) onPatch({ purpose: next === "" ? null : next });
  };

  return (
    <form
      aria-label={t("plan.form.label", { number: node.number })}
      onSubmit={(e) => e.preventDefault()}
      className="flex flex-col gap-3 border-b border-line px-6 py-4"
    >
      <div className="flex items-baseline gap-3">
        <span className="shrink-0 font-mono text-[13px] text-muted">{node.number}</span>
        <input
          aria-label={t("plan.form.title")}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={saveTitle}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          className="min-w-0 flex-1 border-0 bg-transparent p-0 font-serif text-[22px] font-medium leading-tight"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={purposeId}>
          <Label>{t("plan.form.purpose")}</Label>
        </label>
        <Input
          id={purposeId}
          variant="line"
          value={purpose}
          placeholder={t("plan.form.purposePlaceholder")}
          onChange={(e) => setPurpose(e.target.value)}
          onBlur={savePurpose}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
        />
      </div>
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <div className="flex flex-col gap-1">
          <Label>{t("plan.form.status")}</Label>
          <Segmented
            label={t("plan.form.status")}
            value={node.status}
            onChange={(status) => onPatch({ status })}
            options={STATUS_ORDER.map((s) => ({ value: s, label: t(`plan.status.${s}`) }))}
          />
        </div>
        {questions.length > 0 ? (
          <fieldset className="flex min-w-0 flex-col gap-1">
            <legend className="mb-1">
              <Label>{t("plan.form.questions")}</Label>
            </legend>
            <div className="flex flex-wrap gap-1.5">
              {questions.map((q) => {
                const on = node.questions.includes(q.id);
                return (
                  <button
                    key={q.id}
                    type="button"
                    aria-pressed={on}
                    title={q.text}
                    onClick={() =>
                      onPatch({
                        questions: on
                          ? node.questions.filter((x) => x !== q.id)
                          : [...node.questions, q.id].sort(),
                      })
                    }
                    className={cn(
                      "border px-2 py-[3px] font-mono text-[12px]",
                      on ? "border-ink bg-ink text-bg" : "border-line text-ink hover:bg-sunken",
                    )}
                  >
                    {t("project.questionShort", { n: q.id.replace(/^q/, "") })}
                  </button>
                );
              })}
            </div>
          </fieldset>
        ) : null}
      </div>
    </form>
  );
}
