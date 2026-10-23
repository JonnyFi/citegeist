import { cardsExport, cardsRegenerate, cardsUpdate } from "@citegeist/ops";
import type { ModelStamp } from "@citegeist/schema";
import { CardKind } from "@citegeist/schema";
import { useEffect, useId, useRef, useState } from "react";
import { type I18n, useI18n } from "../i18n";
import { AI_LANGUAGES } from "../lib/ai-language";
import { type CardJob, isPending } from "../lib/card-jobs";
import { copyRich } from "../lib/clipboard";
import { locatorText } from "../lib/format";
import { useCore, useOpMutation } from "../lib/hooks";
import { describeError } from "../lib/utils";
import type { CardData } from "./card-list";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Select } from "./ui/select";

/** "claude-code/haiku, 2. Okt. 2026, de": who wrote an AI text, when and in which language. */
export function stampText({ lang }: I18n, stamp: ModelStamp): string {
  const date = new Date(stamp.at).toLocaleDateString(lang, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return [stamp.by, date, stamp.language].filter(Boolean).join(", ");
}

/** Multi-line field that saves when it loses focus, and only if the text changed. */
function SavedField({
  label,
  value,
  onSave,
  rows = 3,
}: {
  label: string;
  value: string;
  onSave: (next: string) => void;
  rows?: number;
}) {
  const id = useId();
  const ref = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState(value);

  // follow outside changes (another window, an agent) unless the reader is typing here
  useEffect(() => {
    if (document.activeElement !== ref.current) setDraft(value);
  }, [value]);

  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs uppercase tracking-wide text-muted">
        {label}
      </label>
      <textarea
        id={id}
        ref={ref}
        rows={rows}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== value) onSave(draft);
        }}
        className="w-full resize-y border border-line bg-surface p-2 font-serif text-[15px] leading-relaxed"
      />
    </div>
  );
}

function AiText({
  title,
  text,
  stamp,
  pending,
}: {
  title: string;
  text: string | undefined;
  stamp: ModelStamp | undefined;
  pending: boolean;
}) {
  const i18n = useI18n();
  const { t } = i18n;
  return (
    <div>
      <div className="mb-1 flex items-center gap-2 text-xs uppercase tracking-wide text-muted">
        {title}
        {text ? <Badge>{t("card.ai")}</Badge> : null}
      </div>
      {pending && !text ? (
        <div role="status" aria-label={t("card.pending")} className="flex flex-col gap-1.5">
          <div className="h-3.5 w-11/12 animate-pulse bg-sunken" />
          <div className="h-3.5 w-7/12 animate-pulse bg-sunken" />
        </div>
      ) : text ? (
        <>
          <p className={pending ? "opacity-50" : undefined}>{text}</p>
          {stamp ? <p className="mt-0.5 text-xs text-muted">{stampText(i18n, stamp)}</p> : null}
        </>
      ) : (
        <p className="text-muted">{t("card.noAiText")}</p>
      )}
    </div>
  );
}

/** One card in full: AI texts with their origin, own words, comment, kind, tags and copy actions. */
export function CardEditor({
  card,
  job,
  defaultLanguage,
  onJob,
}: {
  card: CardData;
  job: CardJob | undefined;
  /** Effective AI language of the source (D9), preselected for regenerating. */
  defaultLanguage: string;
  onJob: (cardId: string, jobId: string, baseline?: string) => void;
}) {
  const i18n = useI18n();
  const { t } = i18n;
  const core = useCore();
  const { frontmatter: fm, body } = card;
  const update = useOpMutation(cardsUpdate);
  const regenerate = useOpMutation(cardsRegenerate);
  const [regenLanguage, setRegenLanguage] = useState(defaultLanguage);
  const [tags, setTags] = useState(fm.tags.join(", "));
  const [copy, setCopy] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const pending = isPending(job, fm.paraphrase);
  const patch = (next: Parameters<typeof update.mutate>[0]["patch"]) =>
    update.mutate({ id: fm.id, patch: next });

  const copyAs = async (mode: "direct" | "indirect") => {
    setCopy(null);
    try {
      const out = await core.call(cardsExport, {
        ids: [fm.id],
        mode,
        format: "html",
        ...(fm.projects[0] ? { project: fm.projects[0] } : {}),
      });
      await copyRich(out);
      setCopy({
        kind: "ok",
        text: t(mode === "direct" ? "card.copiedDirect" : "card.copiedIndirect"),
      });
    } catch (err) {
      setCopy({ kind: "error", text: describeError(err).message });
    }
  };

  const saveTags = () => {
    const next = tags
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (next.join("\u0000") !== fm.tags.join("\u0000")) patch({ tags: next });
  };

  const locator = locatorText(i18n, fm.locator);
  const failure = update.error ?? regenerate.error;

  return (
    <div data-testid="card-editor" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          label={t("card.kind")}
          value={fm.kind}
          onChange={(v) => patch({ kind: CardKind.parse(v) })}
          options={CardKind.options.map((k) => ({ value: k, label: t(`kind.${k}`) }))}
          className="h-7 min-w-32"
        />
        {locator ? <span className="text-muted">{locator}</span> : null}
        {fm.locator && !fm.locator.confirmed ? (
          <Badge tone="outline" title={t("card.pageUnconfirmedHint")}>
            {t("card.pageUnconfirmed")}
          </Badge>
        ) : null}
      </div>

      <blockquote className="border-l-2 border-accent pl-3 font-serif text-[15.5px] leading-relaxed">
        {body.quote}
      </blockquote>

      <AiText title={t("card.core")} text={body.core} stamp={fm.core} pending={pending} />
      <AiText
        title={t("card.paraphrase")}
        text={body.paraphrase}
        stamp={fm.paraphrase}
        pending={pending}
      />
      {pending ? <p className="text-xs text-muted">{t("card.pending")}</p> : null}
      {job?.state === "failed" ? (
        <p role="alert" className="text-danger">
          {t("card.jobFailed")}
          {job.message ? ` ${job.message}` : ""}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Select
          label={t("card.regenerateLanguage")}
          value={regenLanguage}
          onChange={setRegenLanguage}
          options={AI_LANGUAGES.map((l) => ({ value: l, label: t(`aiLang.${l}`) }))}
          className="h-7 min-w-32"
        />
        <Button
          size="sm"
          disabled={pending || regenerate.isPending}
          onClick={() =>
            regenerate.mutate(
              { id: fm.id, language: regenLanguage },
              { onSuccess: (out) => onJob(fm.id, out.job, fm.paraphrase?.at) },
            )
          }
        >
          {t("card.regenerate")}
        </Button>
      </div>

      <SavedField
        label={t("card.ownWords")}
        value={body.ownWords ?? ""}
        onSave={(ownWords) => patch({ ownWords })}
      />
      <SavedField
        label={t("card.comment")}
        value={body.comment ?? ""}
        onSave={(comment) => patch({ comment })}
        rows={2}
      />

      <div>
        <label
          htmlFor={`${fm.id}-tags`}
          className="mb-1 block text-xs uppercase tracking-wide text-muted"
        >
          {t("card.tags")}
        </label>
        <input
          id={`${fm.id}-tags`}
          value={tags}
          placeholder={t("card.tagsPlaceholder")}
          onChange={(e) => setTags(e.target.value)}
          onBlur={saveTags}
          onKeyDown={(e) => {
            if (e.key === "Enter") saveTags();
          }}
          className="h-8 w-full border border-line bg-surface px-2.5 text-sm placeholder:text-muted"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <Button size="sm" variant="primary" onClick={() => void copyAs("direct")}>
          {t("card.copyDirect")}
        </Button>
        <Button size="sm" onClick={() => void copyAs("indirect")}>
          {t("card.copyIndirect")}
        </Button>
        {copy ? (
          <span
            role={copy.kind === "error" ? "alert" : "status"}
            className={copy.kind === "error" ? "text-danger" : "text-muted"}
          >
            {copy.text}
          </span>
        ) : null}
      </div>
      {failure ? (
        <p role="alert" className="text-danger">
          {describeError(failure).message}
        </p>
      ) : null}
    </div>
  );
}
