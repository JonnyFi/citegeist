import {
  jobsGet,
  type LitsearchPreprint,
  litsearchPreprints,
  litsearchPreprintsCheck,
  litsearchPreprintsImport,
} from "@citegeist/ops";
import { Link } from "@tanstack/react-router";
import { ExternalLink, FileText } from "lucide-react";
import { type FormEvent, useId, useRef, useState } from "react";
import { HeaderSlot, Label, SubBar } from "../components/layout";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { EmptyState, ErrorState, Loading } from "../components/ui/states";
import { useI18n } from "../i18n";
import { useCore, useOp, useOpMutation } from "../lib/hooks";
import { ErrorLine, FieldLabel, useGuarded } from "../settings/parts";
import { LitsearchTabs } from "./tabs";

const origin = (o: string) => o.replace(/^run:/, "").replace(/^import:/, "");

function Row({ item }: { item: LitsearchPreprint }) {
  const { t } = useI18n();
  return (
    <li
      data-testid="litsearch-preprint"
      className="flex flex-col gap-1 border-b border-line-soft py-3"
    >
      <span className="font-medium">{item.title || item.doi}</span>
      <span className="font-mono text-[12px] text-muted">
        {[item.arxiv ? `arXiv:${item.arxiv}` : item.doi].filter(Boolean).join(" · ")}
      </span>
      {item.published ? (
        <a
          href={`https://doi.org/${item.published.doi}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-[13px] underline"
        >
          {t("litsearch.preprints.publishedIn", {
            venue: item.published.venue || item.published.doi,
          })}
          {item.published.year ? ` (${item.published.year})` : ""}
          <ExternalLink className="size-3" />
        </a>
      ) : null}
      {item.acceptedAt ? (
        <span className="text-[13px]">
          {t("litsearch.preprints.acceptedAt", { venue: item.acceptedAt })}
        </span>
      ) : null}
      <span className="text-[12px] text-muted">
        {t("litsearch.preprints.from")}{" "}
        {item.from.map((o, i) => (
          <span key={o}>
            {i > 0 ? ", " : ""}
            {o.startsWith("run:") ? (
              <Link to="/litsearch/$runId" params={{ runId: origin(o) }} className="underline">
                {origin(o)}
              </Link>
            ) : (
              origin(o)
            )}
          </span>
        ))}
      </span>
    </li>
  );
}

function Group({ label, items }: { label: string; items: LitsearchPreprint[] }) {
  if (items.length === 0) return null;
  return (
    <section className="flex flex-col gap-1 border-t border-line pt-4">
      <div className="flex items-baseline gap-3">
        <h2 className="font-serif text-[20px] font-medium">{label}</h2>
        <span className="font-mono text-[12px] text-muted">{items.length}</span>
      </div>
      <ul>
        {items.map((i) => (
          <Row key={i.id} item={i} />
        ))}
      </ul>
    </section>
  );
}

/** Import of a references.bib or Markdown list: file picker (desktop) or a path. */
function ImportForm() {
  const { t, tn } = useI18n();
  const core = useCore();
  const run = useOpMutation(litsearchPreprintsImport);
  const guard = useGuarded();
  const [path, setPath] = useState("");
  const [result, setResult] = useState<string>();
  const fileRef = useRef<HTMLInputElement>(null);
  const pathId = useId();
  const submit = async (p: string) => {
    setResult(undefined);
    const out = await guard.run(() => run.mutateAsync({ path: p }));
    if (out) {
      setResult(tn("litsearch.preprints.imported", out.added));
      setPath("");
    }
  };
  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        if (path.trim()) void submit(path.trim());
      }}
      className="flex max-w-[720px] flex-col gap-2"
    >
      <Label>{t("litsearch.preprints.import")}</Label>
      <p className="text-[12px] text-muted">{t("litsearch.preprints.importHint")}</p>
      <div className="flex flex-wrap items-end gap-2">
        <input
          ref={fileRef}
          type="file"
          accept=".bib,.md,.markdown,.txt"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const p =
              window.citegeist?.pathForFile?.(file) ?? (core.isMock ? file.name : undefined);
            if (p) void submit(p);
            e.target.value = "";
          }}
        />
        <Button type="button" size="sm" onClick={() => fileRef.current?.click()}>
          <FileText className="size-3.5" />
          {t("litsearch.preprints.pick")}
        </Button>
        <div className="flex flex-col gap-1">
          <FieldLabel htmlFor={pathId}>{t("litsearch.preprints.path")}</FieldLabel>
          <Input
            id={pathId}
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="~/paper/references.bib"
            className="w-80 font-mono"
          />
        </div>
        <Button type="submit" size="sm" disabled={!path.trim() || run.isPending}>
          {t("litsearch.preprints.importButton")}
        </Button>
      </div>
      {result ? (
        <p role="status" className="text-[12px] text-muted">
          {result}
        </p>
      ) : null}
      <ErrorLine error={guard.error} />
    </form>
  );
}

/** Tracked preprints, the ones published since, the check and the import. */
export function LitsearchPreprintsScreen() {
  const { t } = useI18n();
  const [job, setJob] = useState<string>();
  const running = useOp(
    jobsGet,
    { job: job ?? "" },
    {
      enabled: Boolean(job),
      refetchInterval: (q) =>
        q.state.data && ["succeeded", "failed", "cancelled"].includes(q.state.data.status)
          ? false
          : 1000,
    },
  );
  // an unknown job (e.g. after a restart of the core) counts as finished
  const checking =
    Boolean(job) &&
    !running.isError &&
    !["succeeded", "failed", "cancelled"].includes(running.data?.status ?? "");
  const list = useOp(litsearchPreprints, {}, { refetchInterval: checking ? 2000 : false });
  const check = useOpMutation(litsearchPreprintsCheck);
  const guard = useGuarded();
  const all = [...(list.data?.published ?? []), ...(list.data?.tracked ?? [])];
  const by = (s: LitsearchPreprint["status"]) => all.filter((p) => p.status === s);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <HeaderSlot>
        <Link to="/litsearch" className="text-[13px] font-medium hover:underline">
          {t("litsearch.title")}
        </Link>
      </HeaderSlot>
      <SubBar className="items-center">
        <LitsearchTabs active="preprints" />
        <div className="flex items-center gap-3">
          <span className="text-[12px] text-muted">
            {list.data?.lastCheck
              ? t("litsearch.preprints.lastCheck", {
                  date: list.data.lastCheck.replace("T", " ").slice(0, 16),
                })
              : t("litsearch.preprints.neverChecked")}
          </span>
          <Button
            size="sm"
            variant="primary"
            disabled={checking || check.isPending || all.length === 0}
            onClick={() =>
              void guard.run(async () => {
                const out = await check.mutateAsync({});
                setJob(out.job);
              })
            }
          >
            {checking ? t("litsearch.preprints.checking") : t("litsearch.preprints.check")}
          </Button>
        </div>
      </SubBar>
      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-8 py-6">
        <p className="max-w-[720px] text-[13px] text-muted">{t("litsearch.preprints.desc")}</p>
        <ErrorLine error={guard.error} />
        {running.data?.status === "failed" ? (
          <ErrorLine error={running.data.error?.message ?? t("common.error")} />
        ) : null}
        <ImportForm />
        {list.isPending ? (
          <Loading label={t("litsearch.preprints.loading")} />
        ) : list.isError ? (
          <ErrorState error={list.error} />
        ) : all.length === 0 ? (
          <EmptyState
            title={t("litsearch.preprints.emptyTitle")}
            description={t("litsearch.preprints.emptyDescription")}
          />
        ) : (
          <>
            <Group label={t("litsearch.preprints.published")} items={by("published")} />
            <Group label={t("litsearch.preprints.accepted")} items={by("accepted")} />
            <Group label={t("litsearch.preprints.tracked")} items={by("preprint")} />
          </>
        )}
      </div>
    </div>
  );
}
