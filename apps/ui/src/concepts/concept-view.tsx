import {
  type Concept,
  type ConceptUsageView,
  conceptsCreate,
  conceptsDescribe,
  conceptsGet,
  conceptsList,
  conceptsMerge,
  conceptsUpdate,
  jobsGet,
} from "@citegeist/ops";
import { Link } from "@tanstack/react-router";
import { X } from "lucide-react";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { stampText } from "../components/card-editor";
import { Stamp } from "../components/ui/badge";
import { Button, ButtonGroup } from "../components/ui/button";
import { Input, Textarea } from "../components/ui/input";
import { Star } from "../components/ui/provenance";
import { Select } from "../components/ui/select";
import { ErrorState, Loading } from "../components/ui/states";
import { useI18n } from "../i18n";
import { useOp, useOpMutation } from "../lib/hooks";
import { cn, describeError } from "../lib/utils";
import { useLibraryLinks } from "../notes/library-links";

const POLL_MS = 600;

/** Progress of one describe job: a 4px bar and the count of sources. */
function DescribeProgress({ job, sources }: { job: string; sources: number }) {
  const { t } = useI18n();
  const query = useOp(
    jobsGet,
    { job },
    {
      refetchInterval: (q) => {
        const s = q.state.data?.status;
        return s === "succeeded" || s === "failed" || s === "cancelled" ? false : POLL_MS;
      },
    },
  );
  const data = query.data;
  if (!data || data.status === "succeeded" || data.status === "cancelled") return null;
  const share = data.status === "failed" ? 0 : data.progress;
  return (
    <div className="flex items-center gap-2 text-[12px]">
      <span className="text-label font-semibold uppercase tracking-[0.1em] text-muted">
        {t("concepts.describing")}
      </span>
      <div
        role="progressbar"
        aria-label={t("concepts.describing")}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(share * 100)}
        className="h-1 w-24 bg-line-soft"
      >
        <div className="h-full bg-ink" style={{ width: `${share * 100}%` }} />
      </div>
      <span className="font-mono">
        {t("concepts.describeProgress", { done: Math.round(share * sources), total: sources })}
      </span>
    </div>
  );
}

/** Multi-line field that saves when it loses focus, and only if the text changed. */
function NoteField({ value, onSave }: { value: string; onSave: (next: string) => void }) {
  const { t } = useI18n();
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
        {t("concepts.note")}
      </label>
      <Textarea
        id={id}
        ref={ref}
        rows={3}
        value={draft}
        placeholder={t("concepts.notePlaceholder")}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== value) onSave(draft);
        }}
        className="resize-none leading-[1.5]"
      />
    </div>
  );
}

function Aliases({
  concept,
  onChange,
}: {
  concept: Concept;
  onChange: (ops: Array<{ op: "addAlias" | "removeAlias"; alias: string }>) => void;
}) {
  const { t } = useI18n();
  const [alias, setAlias] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next = alias.trim();
    if (!next) return;
    onChange([{ op: "addAlias", alias: next }]);
    setAlias("");
  };
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[11px] text-muted">{t("concepts.aliases")}</span>
      <ul aria-label={t("concepts.aliases")} className="flex flex-wrap items-center gap-1.5">
        {concept.aliases.length === 0 ? (
          <li className="text-[12px] text-muted">{t("concepts.aliasNone")}</li>
        ) : (
          concept.aliases.map((a) => (
            <li
              key={a}
              className="inline-flex items-center gap-1 border border-line-faint py-[3px] pl-2 pr-1 text-[12px]"
            >
              {a}
              <button
                type="button"
                aria-label={t("concepts.aliasRemove", { name: a })}
                onClick={() => onChange([{ op: "removeAlias", alias: a }])}
                className="inline-flex size-4 items-center justify-center hover:bg-sunken"
              >
                <X className="size-3" />
              </button>
            </li>
          ))
        )}
      </ul>
      <form onSubmit={submit} className="flex max-w-sm gap-2">
        <Input
          aria-label={t("concepts.aliasAdd")}
          placeholder={t("concepts.aliasAdd")}
          value={alias}
          onChange={(e) => setAlias(e.target.value)}
        />
        <Button type="submit" size="sm" disabled={alias.trim() === ""}>
          {t("concepts.aliasAddSubmit")}
        </Button>
      </form>
    </div>
  );
}

function Entry({ usage }: { usage: ConceptUsageView }) {
  const i18n = useI18n();
  const { t } = i18n;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Stamp>
          {t(usage.role === "defines" ? "concepts.role.defines" : "concepts.role.uses")}
        </Stamp>
        {usage.stale ? (
          <Stamp tone="danger" title={t("concepts.staleHint")}>
            {t("concepts.stale")}
          </Stamp>
        ) : null}
      </div>
      <p
        title={`${t("concepts.entry")}: ${stampText(i18n, usage.stamp)}`}
        className={cn(
          "flex items-baseline gap-2 text-[13px] leading-[1.5]",
          usage.stale && "opacity-60",
        )}
      >
        <Star className="mt-1 text-muted" />
        <span>{usage.text}</span>
      </p>
      <ul aria-label={t("concepts.evidence")} className="flex flex-col gap-1.5">
        {usage.evidence.map((e) => (
          <li key={`${e.card}-${e.quote.slice(0, 16)}`} className="flex items-baseline gap-2">
            <Link
              to="/items/$citekey"
              params={{ citekey: usage.item }}
              search={{ tab: "read", card: e.card }}
              aria-label={
                e.page
                  ? t("concepts.evidenceOpen", { page: t("concepts.page", { page: e.page }) })
                  : t("concepts.evidenceOpenNoPage")
              }
              className="shrink-0 border border-line-faint px-1.5 py-[1px] font-mono text-[11px] hover:bg-sunken"
            >
              {e.page ? t("concepts.page", { page: e.page }) : "·"}
            </Link>
            <blockquote className="m-0 font-serif text-[13px] italic leading-[1.5] text-ink/85">
              {e.quote}
            </blockquote>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Sources({ concept, onRemove }: { concept: Concept; onRemove: (card: string) => void }) {
  const { t, tn } = useI18n();
  const { index } = useLibraryLinks();
  const items = [...new Set(concept.members.map((m) => m.item))];
  if (items.length === 0) {
    return <p className="text-muted">{t("concepts.noSources")}</p>;
  }
  return (
    <div className="flex flex-col gap-4">
      {items.map((citekey) => {
        const info = index?.items.get(citekey);
        const title = info?.title ?? citekey;
        const usage = concept.usages.find((u) => u.item === citekey);
        const cards = concept.members.filter((m) => m.item === citekey);
        return (
          <section
            key={citekey}
            aria-label={title}
            data-testid="concept-source"
            className="flex flex-col gap-3 border border-line bg-surface p-4"
          >
            <header className="flex flex-col gap-0.5">
              <Link
                to="/items/$citekey"
                params={{ citekey }}
                aria-label={t("concepts.sourceOpen", { title })}
                className="font-serif text-[16px] font-medium leading-tight hover:underline"
              >
                {title}
              </Link>
              <span className="text-[12px] text-muted">
                {[info?.authors, info?.year].filter(Boolean).join(", ") || citekey}
              </span>
            </header>
            {usage ? (
              <Entry usage={usage} />
            ) : (
              <p className="text-[12px] text-muted">{t("concepts.noEntry")}</p>
            )}
            <details className="text-[12px]">
              <summary className="cursor-pointer text-muted">
                {t("concepts.cardsOf", { n: cards.length })}
              </summary>
              <ul className="mt-2 flex flex-col gap-2">
                {cards.map((c) => (
                  <li key={c.id} data-testid="concept-card" className="flex items-start gap-2">
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 font-serif text-[12px] leading-[1.5]">
                        {c.quote}
                      </span>
                      <span className="font-mono text-[11px] text-muted">
                        {[
                          c.kind ? t(`kind.${c.kind}`) : null,
                          c.page ? t("concepts.page", { page: c.page }) : null,
                        ]
                          .filter(Boolean)
                          .join(", ")}
                      </span>
                    </span>
                    <button
                      type="button"
                      aria-label={`${t("concepts.cardRemove")}: ${c.quote.slice(0, 40)}`}
                      title={t("concepts.cardRemove")}
                      onClick={() => onRemove(c.id)}
                      className="inline-flex size-5 shrink-0 items-center justify-center hover:bg-sunken"
                    >
                      <X className="size-3" />
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          </section>
        );
      })}
      <p className="sr-only">{tn("concepts.sources", items.length)}</p>
    </div>
  );
}

function ConceptBody({ concept }: { concept: Concept }) {
  const { t } = useI18n();
  const update = useOpMutation(conceptsUpdate);
  const describe = useOpMutation(conceptsDescribe);
  const merge = useOpMutation(conceptsMerge);
  const collect = useOpMutation(conceptsCreate);
  const others = useOp(conceptsList, { limit: 500 });
  const [title, setTitle] = useState(concept.title);
  const [job, setJob] = useState<{ id: string; sources: number }>();
  const [absorb, setAbsorb] = useState("");
  const [summary, setSummary] = useState<string>();

  // follow renames made elsewhere unless the reader is typing the name
  useEffect(() => setTitle(concept.title), [concept.title]);

  const failure = update.error ?? describe.error ?? merge.error ?? collect.error;
  const edit = (ops: Parameters<typeof update.mutate>[0]["ops"]) =>
    update.mutate({ id: concept.id, ops });
  const saveTitle = () => {
    const next = title.trim();
    if (next && next !== concept.title) edit([{ op: "rename", title: next }]);
    else setTitle(concept.title);
  };
  const start = (force: boolean) => {
    setSummary(undefined);
    describe.mutate(
      { id: concept.id, force },
      { onSuccess: (out) => setJob({ id: out.job, sources: out.sources }) },
    );
  };
  const choices = (others.data?.concepts ?? []).filter((c) => c.id !== concept.id);
  const describing = describe.isPending || (job !== undefined && summary === undefined);

  return (
    <article className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-8 py-8">
      <div>
        <input
          aria-label={t("concepts.titleLabel")}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={saveTitle}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          className="w-full bg-transparent font-serif text-3xl font-semibold tracking-tight outline-none"
        />
      </div>

      <Aliases concept={concept} onChange={edit} />
      <NoteField value={concept.note} onSave={(note) => edit([{ op: "setNote", note }])} />

      <div
        role="toolbar"
        aria-label={t("concepts.toolbar")}
        className="flex flex-wrap items-center gap-x-4 gap-y-2 border-y border-line-soft py-2"
      >
        <ButtonGroup>
          <Button
            size="sm"
            variant="primary"
            disabled={describing || concept.open === 0}
            onClick={() => start(false)}
          >
            {t("concepts.describe")}
          </Button>
          <Button
            size="sm"
            disabled={describing || concept.sources === 0}
            onClick={() => start(true)}
          >
            {t("concepts.describeAll")}
          </Button>
        </ButtonGroup>
        <Button
          size="sm"
          disabled={collect.isPending}
          onClick={() =>
            collect.mutate({ term: concept.title, aliases: concept.aliases, collect: true })
          }
        >
          {t("concepts.collect")}
        </Button>
        {job ? <DescribeProgress key={job.id} job={job.id} sources={job.sources} /> : null}
        <span className="flex-1" />
        {choices.length > 0 ? (
          <div className="flex items-center gap-2" title={t("concepts.merge.hint")}>
            <Select
              label={t("concepts.merge.label")}
              value={absorb}
              onChange={setAbsorb}
              options={[
                { value: "", label: t("concepts.merge.select") },
                ...choices.map((c) => ({ value: c.id, label: c.title })),
              ]}
              className="min-w-44"
            />
            <Button
              size="sm"
              disabled={absorb === "" || merge.isPending}
              onClick={() =>
                merge.mutate(
                  { into: concept.id, from: [absorb] },
                  { onSuccess: () => setAbsorb("") },
                )
              }
            >
              {t("concepts.merge.submit")}
            </Button>
          </div>
        ) : null}
      </div>

      {failure ? (
        <p role="alert" className="text-danger">
          {describeError(failure, t("concepts.problem")).message}
        </p>
      ) : null}
      {summary ? <p role="status">{summary}</p> : null}
      <JobSummary job={job} onDone={setSummary} />

      <h2 className="font-serif text-[20px] font-medium leading-tight">{t("concepts.sources")}</h2>
      <Sources
        concept={concept}
        onRemove={(card) => edit([{ op: "removeCards", cards: [card] }])}
      />
    </article>
  );
}

/** Reads the result of a finished describe job once and reports it as a line of text. */
function JobSummary({
  job,
  onDone,
}: {
  job: { id: string } | undefined;
  onDone: (text: string) => void;
}) {
  const { t } = useI18n();
  const query = useOp(
    jobsGet,
    { job: job?.id ?? "j_0000000000" },
    {
      enabled: job !== undefined,
      refetchInterval: (q) => {
        const s = q.state.data?.status;
        return s === "succeeded" || s === "failed" || s === "cancelled" ? false : POLL_MS;
      },
    },
  );
  const data = query.data;
  const result =
    data?.status === "succeeded" ? (data.result as Record<string, number> | undefined) : undefined;
  const status = data?.status;
  const written = result?.written;
  const silent = result?.silent;
  const failed = result?.failed;
  useEffect(() => {
    if (status === "failed" || status === "cancelled") onDone(t("concepts.problem"));
  }, [status, onDone, t]);
  useEffect(() => {
    if (written === undefined) return;
    onDone(
      t("concepts.describeSummary", {
        written,
        silent: silent ?? 0,
        failed: failed ?? 0,
      }),
    );
  }, [written, silent, failed, onDone, t]);
  return null;
}

/** One concept: name, aliases, the reader's note and, per source, how it uses or defines the term. */
export function ConceptView({ id }: { id: string }) {
  const { t } = useI18n();
  const concept = useOp(conceptsGet, { id });
  if (concept.isPending) return <Loading label={t("concepts.loading")} />;
  if (concept.isError) return <ErrorState error={concept.error} />;
  return <ConceptBody key={id} concept={concept.data.concept} />;
}
