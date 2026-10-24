import { graphAddCandidates, graphRelated, type MarkedWork } from "@citegeist/ops";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Segmented } from "../components/ui/segmented";
import { EmptyState, ErrorState, Loading } from "../components/ui/states";
import { type MessageKey, useI18n } from "../i18n";
import { useCore, useOpMutation } from "../lib/hooks";
import { describeError } from "../lib/utils";

export type Direction = "references" | "citing";

const PAGE = { references: 200, citing: 50 } as const;

/**
 * Pages of graph.related. The key sits outside the ["op"] family: the call goes to Crossref and
 * OpenAlex, so a file change somewhere in the library must not repeat it.
 */
export function useRelated(citekey: string, direction: Direction) {
  const core = useCore();
  return useInfiniteQuery({
    queryKey: ["related", citekey, direction],
    staleTime: 5 * 60_000,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      core.call(graphRelated, {
        citekey,
        direction,
        limit: PAGE[direction],
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    getNextPageParam: (last) => last.next,
  });
}

/** What identifies a work for the inbox and for React: DOI, arXiv id, OpenAlex id, else the key. */
export function workId(w: MarkedWork, index: number): string {
  return w.doi ?? w.arxiv ?? w.openalex ?? w.key ?? `row-${index}`;
}

function candidateOf(w: MarkedWork) {
  const { status: _status, citekey: _citekey, addable: _addable, ...work } = w;
  return work;
}

function yearOf(value: string): number | undefined {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : undefined;
}

/** Works inside the chosen years. A work without a year only shows while no year is chosen. */
export function filterByYear(
  works: readonly MarkedWork[],
  from: number | undefined,
  to: number | undefined,
): MarkedWork[] {
  if (from === undefined && to === undefined) return [...works];
  return works.filter((w) => {
    if (w.year === undefined) return false;
    return (from === undefined || w.year >= from) && (to === undefined || w.year <= to);
  });
}

function WorkRow({ work, busy, onAdd }: { work: MarkedWork; busy: boolean; onAdd: () => void }) {
  const { t } = useI18n();
  const title = work.title ?? work.raw ?? t("related.untitled");
  const meta = [work.authors, work.container].filter(Boolean).join(" · ");
  return (
    <li
      data-testid="related-work"
      data-status={work.status}
      className="grid grid-cols-[44px_minmax(0,1fr)_132px] items-start gap-4 border-b border-line-soft py-2.5"
    >
      <span className="pt-0.5 font-mono text-[12px] text-muted">{work.year ?? ""}</span>
      <div className="flex min-w-0 flex-col gap-0.5">
        {work.citekey ? (
          <Link
            to="/items/$citekey"
            params={{ citekey: work.citekey }}
            className="font-medium hover:underline"
          >
            {title}
          </Link>
        ) : (
          <span className="font-medium">{title}</span>
        )}
        {meta ? <span className="truncate text-[12px] text-muted">{meta}</span> : null}
        {work.citedBy !== undefined ? (
          <span
            className="font-mono text-[11px] text-muted"
            title={t("related.citedBy", { n: work.citedBy })}
          >
            {t("related.citedBy", { n: work.citedBy })}
          </span>
        ) : null}
      </div>
      <div className="flex justify-end">
        {work.status === "library" ? (
          <Badge tone="accent">{t("related.status.library")}</Badge>
        ) : work.status === "inbox" ? (
          <Link to="/inbox">
            <Badge tone="outline">{t("related.status.inbox")}</Badge>
          </Link>
        ) : (
          <Button
            size="sm"
            disabled={busy || !work.addable}
            title={work.addable ? undefined : t("related.notAddable")}
            aria-label={`${t("related.add")}: ${title}`}
            onClick={onAdd}
          >
            {busy ? t("related.adding") : t("related.add")}
          </Button>
        )}
      </div>
    </li>
  );
}

/**
 * References and citing works of one source, each marked as in the library, in the inbox or new.
 * New works go to the inbox with one click; the person accepts them there.
 */
export function RelatedWorks({ citekey }: { citekey: string }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [direction, setDirection] = useState<Direction>("references");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [adding, setAdding] = useState<ReadonlySet<string>>(new Set());
  const [result, setResult] = useState<{ added: number; duplicates: number; failed: number }>();
  const related = useRelated(citekey, direction);
  const add = useOpMutation(graphAddCandidates);

  const pages = related.data?.pages ?? [];
  const first = pages[0];
  const works = useMemo(() => pages.flatMap((p) => p.works), [pages]);
  const shown = useMemo(() => filterByYear(works, yearOf(from), yearOf(to)), [works, from, to]);
  const fresh = shown.filter((w) => w.status === "new" && w.addable);

  const run = (list: readonly MarkedWork[]) => {
    const ids = list.map((w) => workId(w, works.indexOf(w)));
    setAdding((prev) => new Set([...prev, ...ids]));
    setResult(undefined);
    add.mutate(
      {
        candidates: list.map(candidateOf).slice(0, 50),
        from: citekey,
        via: direction,
      },
      {
        onSuccess: (out) => setResult(out),
        onSettled: () => {
          setAdding((prev) => new Set([...prev].filter((id) => !ids.includes(id))));
          void queryClient.invalidateQueries({ queryKey: ["related", citekey] });
        },
      },
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          label={t("related.direction")}
          value={direction}
          onChange={setDirection}
          options={[
            { value: "references", label: t("related.references") },
            { value: "citing", label: t("related.citing") },
          ]}
        />
        <div className="flex items-center gap-2 text-[12px] text-muted">
          <span>{t("related.year")}</span>
          <Input
            variant="line"
            type="number"
            inputMode="numeric"
            aria-label={t("related.yearFrom")}
            placeholder="1900"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="w-16 font-mono text-[12px]"
          />
          <span aria-hidden="true">–</span>
          <Input
            variant="line"
            type="number"
            inputMode="numeric"
            aria-label={t("related.yearTo")}
            placeholder="2026"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="w-16 font-mono text-[12px]"
          />
        </div>
        <span className="flex-1" />
        <Button size="sm" disabled={fresh.length === 0 || add.isPending} onClick={() => run(fresh)}>
          {t("related.addAll", { n: fresh.length })}
        </Button>
      </div>

      {related.isPending ? (
        <Loading label={t("related.loading")} />
      ) : related.isError ? (
        <ErrorState error={related.error} />
      ) : (
        <>
          {first ? (
            <p className="font-mono text-[12px] text-muted">
              {t("related.summary", {
                total: first.total,
                library: first.counts.library,
                inbox: first.counts.inbox,
                new: first.counts.new,
              })}
              {first.source ? ` · ${t(`related.source.${first.source}` as MessageKey)}` : ""}
            </p>
          ) : null}
          {first && first.errors.length > 0 ? (
            <p role="alert" className="border border-danger px-3 py-2 text-[12px] text-danger">
              {t("related.errors", { errors: first.errors.join("; ") })}
            </p>
          ) : null}
          {result ? (
            <p role="status" className="text-[12px]">
              {t("related.result", result)}
            </p>
          ) : null}
          {add.error ? (
            <p role="alert" className="text-[12px] text-danger">
              {describeError(add.error).message}
            </p>
          ) : null}
          {works.length === 0 ? (
            <EmptyState
              title={
                direction === "references" ? t("related.emptyReferences") : t("related.emptyCiting")
              }
            />
          ) : shown.length === 0 ? (
            <p className="py-2 text-muted">{t("related.noMatch")}</p>
          ) : (
            <ul aria-label={t("related.list")} className="flex flex-col border-t border-line">
              {shown.map((w) => {
                const id = workId(w, works.indexOf(w));
                return <WorkRow key={id} work={w} busy={adding.has(id)} onAdd={() => run([w])} />;
              })}
            </ul>
          )}
          {first && direction === "references" && first.total > works.length ? (
            <p className="text-[12px] text-muted">
              {t("related.truncated", { total: first.total, shown: works.length })}
            </p>
          ) : null}
          {related.hasNextPage ? (
            <div>
              <Button
                size="sm"
                disabled={related.isFetchingNextPage}
                onClick={() => void related.fetchNextPage()}
              >
                {t("related.more")}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
