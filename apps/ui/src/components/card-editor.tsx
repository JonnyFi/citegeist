import { cardsExport, cardsRegenerate, cardsUpdate } from "@citegeist/ops";
import type { ModelStamp } from "@citegeist/schema";
import { CardKind } from "@citegeist/schema";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { CardConcepts } from "../concepts/card-concepts";
import { type I18n, useI18n } from "../i18n";
import { AI_LANGUAGES } from "../lib/ai-language";
import { type CardJob, isPending } from "../lib/card-jobs";
import { kindColor } from "../lib/cards";
import { copyRich } from "../lib/clipboard";
import { locatorText } from "../lib/format";
import { useCore, useOpMutation } from "../lib/hooks";
import { cn, describeError } from "../lib/utils";
import { insertIntoText, useInsertTarget } from "../texts/active";
import type { CardData } from "./card-list";
import { Stamp } from "./ui/badge";
import { Button } from "./ui/button";
import { Input, Textarea } from "./ui/input";
import { Star } from "./ui/provenance";
import { Select } from "./ui/select";

/** Value of the kind select for a card without a kind. */
const NO_KIND = "none";

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
  rows = 2,
  variant,
}: {
  label: string;
  value: string;
  onSave: (next: string) => void;
  rows?: number;
  variant: "line" | "box";
}) {
  const id = useId();
  const ref = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState(value);

  // follow outside changes (another window, an agent) unless the reader is typing here
  useEffect(() => {
    if (document.activeElement !== ref.current) setDraft(value);
  }, [value]);

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-[11px] text-muted">
        {label}
      </label>
      <Textarea
        id={id}
        ref={ref}
        rows={rows}
        variant={variant}
        value={draft}
        placeholder="…"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== value) onSave(draft);
        }}
        className="resize-none leading-[1.5]"
      />
    </div>
  );
}

/**
 * The one AI text of a card. Star and title mark it as machine text, model, date and language
 * sit in a tooltip. `tools` holds the rewrite action, which only the open card shows.
 */
function ParaphraseBlock({
  text,
  stamp,
  dim,
  tools,
}: {
  text: string | undefined;
  stamp: ModelStamp | undefined;
  dim: boolean;
  tools?: ReactNode;
}) {
  const i18n = useI18n();
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2 text-[11px] text-muted">
        <span
          className="flex items-center gap-1.5"
          title={stamp ? stampText(i18n, stamp) : undefined}
        >
          <Star />
          <span>{i18n.t("card.paraphrase")}</span>
        </span>
        {tools}
      </div>
      {text ? (
        <p className={cn("text-[13px] leading-[1.5] text-ink/85", dim && "opacity-50")}>{text}</p>
      ) : null}
    </div>
  );
}

/**
 * The quote card, the main object of the app. White sheet with a 1px border on the sunken column:
 * a 32px head with a 6px colour tab, kind and page, then separate layers for the verbatim quote,
 * the paraphrase (sunken, with a star; model and time in a tooltip) and the reader's note. The
 * paraphrase block holds the rewrite action and its language. Two quote actions sit in a split bar
 * at the bottom.
 *
 * `list` shows the card read-only (overview). `panel` is the reader column: collapsed it is a
 * head and the quote, open it holds every field and action.
 */
export function QuoteCard({
  card,
  mode,
  open = false,
  onToggle,
  onOpenInReader,
  job,
  onJob,
  defaultLanguage = "de",
  orphaned = false,
}: {
  card: CardData;
  mode: "list" | "panel";
  open?: boolean;
  onToggle?: () => void;
  onOpenInReader?: () => void;
  job?: CardJob | undefined;
  onJob?: (cardId: string, jobId: string, baseline?: string) => void;
  defaultLanguage?: string;
  orphaned?: boolean;
}) {
  const i18n = useI18n();
  const { t } = i18n;
  const core = useCore();
  const { frontmatter: fm, body } = card;
  const insertTarget = useInsertTarget();
  const update = useOpMutation(cardsUpdate);
  const regenerate = useOpMutation(cardsRegenerate);
  const [regenLanguage, setRegenLanguage] = useState(defaultLanguage);
  const [tags, setTags] = useState(fm.tags.join(", "));
  const [copy, setCopy] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  // the confirmation is short-lived, errors stay until the next try
  useEffect(() => {
    if (copy?.kind !== "ok") return;
    const timer = setTimeout(() => setCopy(null), 4000);
    return () => clearTimeout(timer);
  }, [copy]);

  const pending = isPending(job, fm.paraphrase);
  const failed = job?.state === "failed";
  const editing = mode === "panel" && open;
  const color = kindColor(fm.kind);
  const locator = locatorText(i18n, fm.locator);
  const unconfirmed = fm.locator !== undefined && !fm.locator.confirmed;
  const failure = update.error ?? regenerate.error;

  const patch = (next: Parameters<typeof update.mutate>[0]["patch"]) =>
    update.mutate({ id: fm.id, patch: next });

  const rewrite = (language: string) =>
    regenerate.mutate(
      { id: fm.id, language },
      { onSuccess: (out) => onJob?.(fm.id, out.job, fm.paraphrase?.at) },
    );

  const copyAs = async (mode: "direct" | "indirect") => {
    setCopy(null);
    try {
      if (insertTarget) {
        // a text is open: the quotation goes into it, with the citation in Pandoc syntax (D20)
        const out = await core.call(cardsExport, {
          ids: [fm.id],
          mode,
          format: "pandoc",
          project: insertTarget.project,
        });
        const into = await insertIntoText(core, out.text);
        setCopy({ kind: "ok", text: t("card.insertedIn", { title: into.title }) });
        return;
      }
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

  const headInner = (
    <>
      <span aria-hidden="true" className="w-1.5 shrink-0" style={{ background: color }} />
      <span className="flex min-w-0 flex-1 items-center justify-between gap-2 px-3">
        <span className="text-label font-semibold uppercase tracking-[0.1em]" style={{ color }}>
          {fm.kind ? t(`kind.${fm.kind}`) : null}
        </span>
        <span className="flex min-w-0 items-center gap-2">
          {locator ? <span className="font-mono text-[12px]">{locator}</span> : null}
          {unconfirmed ? (
            <Stamp tone="danger" title={t("card.pageUnconfirmedHint")}>
              {t("card.pageUnconfirmed")}
            </Stamp>
          ) : null}
          {orphaned ? <Stamp title={t("card.orphanedHint")}>{t("card.orphaned")}</Stamp> : null}
        </span>
      </span>
    </>
  );

  const rewriteTools = editing ? (
    <span className="flex items-center gap-2">
      <Select
        label={t("card.regenerateLanguage")}
        value={regenLanguage}
        onChange={setRegenLanguage}
        options={AI_LANGUAGES.map((l) => ({ value: l, label: t(`aiLang.${l}`) }))}
        className="h-5 min-w-0 gap-1 px-1.5 text-[11px]"
      />
      <button
        type="button"
        disabled={pending || regenerate.isPending}
        onClick={() => rewrite(regenLanguage)}
        className="h-5 border border-line px-1.5 text-[11px] hover:bg-bg disabled:opacity-50"
      >
        {t("card.regenerate")}
      </button>
    </span>
  ) : null;

  const aiLayer =
    body.paraphrase || pending || failed || editing ? (
      <div className="flex flex-col gap-2.5 border-t border-line-faint bg-sunken px-3 py-2.5">
        <ParaphraseBlock
          text={body.paraphrase}
          stamp={fm.paraphrase}
          dim={pending}
          tools={rewriteTools}
        />
        {!body.paraphrase && !pending && !failed ? (
          <p className="text-[12px] text-muted">{t("card.noAiText")}</p>
        ) : null}
        {pending ? (
          <div role="status" className="flex items-center gap-2 text-[11px] italic text-muted">
            <span aria-hidden="true" className="size-2 shrink-0" style={{ background: color }} />
            {t("card.pending")}
          </div>
        ) : null}
        {failed ? (
          <div className="flex flex-wrap items-center gap-3">
            <p role="alert" className="text-[12px] text-danger">
              {t("card.jobFailed")}
              {job?.message ? ` ${job.message}` : ""}
            </p>
            {editing ? (
              <Button
                size="sm"
                disabled={regenerate.isPending}
                onClick={() => rewrite(regenLanguage)}
              >
                {t("card.retry")}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    ) : null;

  const note = body.note ?? "";

  return (
    <article
      data-testid={mode === "list" ? "card" : editing ? "card-editor" : undefined}
      className="flex flex-col border border-line bg-surface"
    >
      {mode === "panel" ? (
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          className="flex h-8 w-full items-stretch border-b border-line text-left hover:bg-sunken"
        >
          {headInner}
        </button>
      ) : (
        <div className="flex h-8 items-stretch border-b border-line">{headInner}</div>
      )}

      <blockquote
        className={cn(
          "m-0 p-3 font-serif text-card",
          mode === "panel" && !open && "line-clamp-4",
          orphaned && "text-muted",
        )}
      >
        {body.quote}
      </blockquote>
      {orphaned ? (
        <p className="border-t border-line-faint px-3 py-2.5 text-[12px] leading-[1.5] text-muted">
          {t("card.orphanedHint")}
        </p>
      ) : null}

      {mode === "panel" && !open ? (
        pending ? (
          <div
            role="status"
            className="flex items-center gap-2 border-t border-line-faint bg-sunken px-3 py-2.5 text-[11px] italic text-muted"
          >
            <span aria-hidden="true" className="size-2 shrink-0" style={{ background: color }} />
            {t("card.pendingShort")}
          </div>
        ) : null
      ) : (
        <>
          {aiLayer}
          {editing ? (
            <div className="flex flex-col gap-3 border-t border-line-faint px-3 py-2.5">
              <SavedField
                label={t("card.note")}
                value={note}
                variant="line"
                rows={3}
                onSave={(next) => patch({ note: next })}
              />
              <div className="flex flex-wrap items-end gap-3">
                <Select
                  label={t("card.kind")}
                  value={fm.kind ?? NO_KIND}
                  onChange={(v) => patch({ kind: v === NO_KIND ? null : CardKind.parse(v) })}
                  options={[
                    { value: NO_KIND, label: t("kind.none") },
                    ...CardKind.options.map((k) => ({ value: k, label: t(`kind.${k}`) })),
                  ]}
                  className="min-w-32"
                />
                <div className="flex min-w-40 flex-1 flex-col gap-1">
                  <label htmlFor={`${fm.id}-tags`} className="text-[11px] text-muted">
                    {t("card.tags")}
                  </label>
                  <Input
                    id={`${fm.id}-tags`}
                    value={tags}
                    placeholder={t("card.tagsPlaceholder")}
                    onChange={(e) => setTags(e.target.value)}
                    onBlur={saveTags}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveTags();
                    }}
                  />
                </div>
              </div>
            </div>
          ) : note ? (
            <div className="flex flex-col gap-1 border-t border-line-faint px-3 py-2.5">
              <span className="text-[11px] text-muted">{t("card.note")}</span>
              <p className="whitespace-pre-line text-[13px] leading-[1.5]">{note}</p>
            </div>
          ) : null}

          <CardConcepts cardId={fm.id} />

          {copy ? (
            <p
              role={copy.kind === "error" ? "alert" : "status"}
              className={cn(
                "border-t border-line-faint px-3 py-2 text-[12px]",
                copy.kind === "error" ? "text-danger" : "text-muted",
              )}
            >
              {copy.text}
            </p>
          ) : null}
          {failure ? (
            <p
              role="alert"
              className="border-t border-line-faint px-3 py-2 text-[12px] text-danger"
            >
              {describeError(failure).message}
            </p>
          ) : null}

          {editing ? (
            <div className="grid grid-cols-2 border-t border-line">
              <button
                type="button"
                title={
                  insertTarget
                    ? t("card.quoteDirectInsertHint", { title: insertTarget.title })
                    : t("card.quoteDirectHint")
                }
                onClick={() => void copyAs("direct")}
                className="h-8 border-r border-line text-[12px] hover:bg-sunken"
              >
                {t("card.quoteDirect")}
              </button>
              <button
                type="button"
                title={
                  insertTarget
                    ? t("card.quoteIndirectInsertHint", { title: insertTarget.title })
                    : t("card.quoteIndirectHint")
                }
                onClick={() => void copyAs("indirect")}
                className="h-8 text-[12px] hover:bg-sunken"
              >
                {t("card.quoteIndirect")}
              </button>
            </div>
          ) : onOpenInReader ? (
            <div className="flex border-t border-line">
              <button
                type="button"
                onClick={onOpenInReader}
                className="h-8 flex-1 text-[12px] hover:bg-sunken"
              >
                {t("card.openInReader")}
              </button>
            </div>
          ) : null}
        </>
      )}
    </article>
  );
}
