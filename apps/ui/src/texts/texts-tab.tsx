import { textsCreate, textsList } from "@citegeist/ops";
import { FileText, Plus } from "lucide-react";
import { useId, useState } from "react";
import { Label } from "../components/layout";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { EmptyState, ErrorState, Loading } from "../components/ui/states";
import { useI18n } from "../i18n";
import { useOp, useOpMutation } from "../lib/hooks";
import { cn, describeError } from "../lib/utils";
import { TextView } from "./text-view";

/** What the URL says about the Texte tab. */
export interface TextsSearch {
  text?: string | undefined;
}

function NewTextForm({
  project,
  onCreated,
  onCancel,
}: {
  project: string;
  onCreated: (slug: string) => void;
  onCancel?: () => void;
}) {
  const { t } = useI18n();
  const create = useOpMutation(textsCreate);
  const nameId = useId();
  const [title, setTitle] = useState("");

  return (
    <form
      aria-label={t("texts.new.title")}
      onSubmit={(e) => {
        e.preventDefault();
        const name = title.trim();
        if (!name) return;
        create.mutate({ project, title: name }, { onSuccess: (out) => onCreated(out.text) });
      }}
      className="flex max-w-[560px] flex-col gap-3 border border-line p-4"
    >
      <label htmlFor={nameId}>
        <Label>{t("texts.new.name")}</Label>
      </label>
      <Input
        id={nameId}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={t("texts.new.placeholder")}
        autoFocus
      />
      <div className="flex items-center gap-2">
        <Button
          type="submit"
          variant="primary"
          size="sm"
          disabled={create.isPending || !title.trim()}
        >
          {t("texts.new.create")}
        </Button>
        {onCancel ? (
          <Button type="button" size="sm" onClick={onCancel}>
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

const row = (active: boolean) =>
  cn(
    "flex w-full flex-col gap-0.5 border-b border-line-soft px-3 py-2.5 text-left",
    active ? "bg-sunken" : "hover:bg-sunken",
  );

/** The Texte tab of a project: the texts as Markdown files, and one of them in the editor. */
export function TextsTab({
  project,
  projectStyle,
  projectLang,
  search,
  onSearch,
}: {
  project: string;
  projectStyle: string;
  projectLang: string;
  search: TextsSearch;
  onSearch: (next: TextsSearch) => void;
}) {
  const { t, tn } = useI18n();
  const texts = useOp(textsList, { project });
  const [creating, setCreating] = useState(false);

  if (texts.isPending) return <Loading label={t("texts.loading")} />;
  if (texts.isError) return <ErrorState error={texts.error} />;

  const list = texts.data.texts;
  if (list.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-8 py-8">
        <EmptyState
          icon={<FileText />}
          title={t("texts.emptyTitle")}
          description={t("texts.emptyDescription")}
        />
        <div className="px-8">
          <NewTextForm project={project} onCreated={(slug) => onSearch({ text: slug })} />
        </div>
      </div>
    );
  }

  const current = list.find((x) => x.text === search.text) ?? list[0];
  if (!current) return null;

  return (
    <div className="flex min-h-0 flex-1">
      <nav
        aria-label={t("texts.navigation")}
        className="flex w-[280px] shrink-0 flex-col overflow-y-auto border-r border-line"
      >
        {list.map((x) => (
          <button
            key={x.text}
            type="button"
            data-testid="text-row"
            aria-current={x.text === current.text ? "true" : undefined}
            aria-label={t("texts.openText", { title: x.title })}
            onClick={() => {
              setCreating(false);
              onSearch({ text: x.text });
            }}
            className={row(x.text === current.text && !creating)}
          >
            <span className="flex items-center gap-2 font-medium">
              <FileText aria-hidden="true" className="size-4 shrink-0" />
              <span className="truncate">{x.title}</span>
            </span>
            <span className="pl-6 text-[12px] text-muted">
              {tn("texts.stats", x.citations, { words: x.words })}
            </span>
          </button>
        ))}
        <div className="p-3">
          <Button size="sm" aria-expanded={creating} onClick={() => setCreating((c) => !c)}>
            <Plus className="size-3.5" />
            {t("texts.new.button")}
          </Button>
        </div>
      </nav>
      <section aria-label={t("texts.content")} className="flex min-w-0 flex-1 flex-col">
        {creating ? (
          <div className="overflow-y-auto px-8 py-6">
            <NewTextForm
              project={project}
              onCreated={(slug) => {
                setCreating(false);
                onSearch({ text: slug });
              }}
              onCancel={() => setCreating(false)}
            />
          </div>
        ) : (
          <TextView
            key={current.text}
            project={project}
            text={current.text}
            projectStyle={projectStyle}
            projectLang={projectLang}
          />
        )}
      </section>
    </div>
  );
}
