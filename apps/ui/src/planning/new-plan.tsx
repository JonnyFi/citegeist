import { plansCreate } from "@citegeist/ops";
import type { PlanTemplate } from "@citegeist/schema";
import { useId, useState } from "react";
import { Label } from "../components/layout";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Segmented } from "../components/ui/segmented";
import { useI18n } from "../i18n";
import { useOpMutation } from "../lib/hooks";
import { describeError } from "../lib/utils";
import { slugify } from "./outline";

type Choice = PlanTemplate | "blank";

/** Free slug for a title: "paper" taken, so "paper-2". */
export function freeSlug(title: string, taken: readonly string[]): string {
  const base = slugify(title);
  let slug = base;
  for (let n = 2; taken.includes(slug); n++) slug = `${base}-${n}`;
  return slug;
}

/** Creates a plan from the Exposé or IMRaD template, or an empty one. */
export function NewPlanForm({
  project,
  taken,
  onCreated,
  onCancel,
}: {
  project: string;
  taken: readonly string[];
  onCreated: (slug: string) => void;
  onCancel?: () => void;
}) {
  const { t } = useI18n();
  const create = useOpMutation(plansCreate);
  const nameId = useId();
  const [choice, setChoice] = useState<Choice>("expose");
  const [edited, setEdited] = useState(false);
  const [title, setTitle] = useState(t("plan.template.expose"));

  const pick = (next: Choice) => {
    setChoice(next);
    if (!edited) setTitle(t(`plan.template.${next}`));
  };

  return (
    <form
      aria-label={t("plan.new.title")}
      onSubmit={(e) => {
        e.preventDefault();
        const name = title.trim();
        if (!name) return;
        const slug = freeSlug(name, taken);
        create.mutate(
          { project, slug, title: name, ...(choice === "blank" ? {} : { template: choice }) },
          { onSuccess: (out) => onCreated(out.plan) },
        );
      }}
      className="flex max-w-[560px] flex-col gap-4 border border-line p-5"
    >
      <h2 className="font-serif text-[20px] font-medium leading-tight">{t("plan.new.title")}</h2>
      <div className="flex flex-col gap-1.5">
        <Label>{t("plan.new.template")}</Label>
        <Segmented
          label={t("plan.new.template")}
          value={choice}
          onChange={pick}
          options={[
            { value: "expose", label: t("plan.template.expose") },
            { value: "imrad", label: t("plan.template.imrad") },
            { value: "blank", label: t("plan.template.blank") },
          ]}
        />
        <p className="text-[12px] text-muted">{t(`plan.template.${choice}.hint`)}</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={nameId}>
          <Label>{t("plan.new.name")}</Label>
        </label>
        <Input
          id={nameId}
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            setEdited(true);
          }}
        />
      </div>
      <div className="flex items-center gap-2">
        <Button type="submit" variant="primary" disabled={create.isPending || !title.trim()}>
          {t("plan.new.create")}
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
    </form>
  );
}
