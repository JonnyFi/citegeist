import {
  type LitsearchPaper,
  type LitsearchRunSummary,
  litsearchCompare,
  litsearchGet,
  litsearchRuns,
} from "@citegeist/ops";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowDown, ArrowLeftRight, ArrowUp } from "lucide-react";
import type { ReactNode } from "react";
import { HeaderSlot, Label, SubBar } from "../components/layout";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { ErrorState, Loading } from "../components/ui/states";
import { type MessageKey, useI18n } from "../i18n";
import { useOp } from "../lib/hooks";

const when = (r: Pick<LitsearchRunSummary, "created">) => r.created.replace("T", " ").slice(0, 16);

/** "Compare with" on a finished run: picks another finished run; the earlier one becomes `a`. */
export function CompareWith({ run }: { run: LitsearchRunSummary }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const runs = useOp(litsearchRuns, { limit: 200 });
  const others = (runs.data?.runs ?? []).filter((r) => r.id !== run.id && r.status === "done");
  if (others.length === 0) return null;
  return (
    <label className="flex items-center gap-2 text-[12px]">
      <span className="text-muted">{t("litsearch.compare")}</span>
      <select
        aria-label={t("litsearch.compare")}
        value=""
        onChange={(e) => {
          const other = others.find((r) => r.id === e.target.value);
          if (!other) return;
          const [a, b] = other.created <= run.created ? [other, run] : [run, other];
          void navigate({ to: "/litsearch/compare", search: { a: a.id, b: b.id } });
        }}
        className="h-[26px] max-w-56 border border-line bg-transparent px-2"
      >
        <option value="">{t("litsearch.compare.pick")}</option>
        {others.map((r) => (
          <option key={r.id} value={r.id}>
            {`${when(r)} · ${r.topic}`}
          </option>
        ))}
      </select>
    </label>
  );
}

function Group({
  label,
  description,
  count,
  testId,
  children,
}: {
  label: string;
  description: string;
  count: number;
  testId: string;
  children: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <section data-testid={testId} className="flex flex-col gap-2 border-t border-line pt-4">
      <div className="flex items-baseline gap-3">
        <h2 className="font-serif text-[20px] font-medium">{label}</h2>
        <span className="font-mono text-[12px] text-muted">{count}</span>
      </div>
      <p className="text-[12px] text-muted">{description}</p>
      {count === 0 ? <p className="text-muted">{t("litsearch.compare.empty")}</p> : children}
    </section>
  );
}

function Row({ paper, extra }: { paper: LitsearchPaper; extra?: ReactNode }) {
  const { t } = useI18n();
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 border-b border-line-soft py-2">
      <div className="flex min-w-0 flex-col">
        <span className="truncate font-medium">{paper.title}</span>
        <span className="truncate text-[12px] text-muted">
          {[paper.authors.slice(0, 3).join(", "), paper.year, paper.venue]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </div>
      <div className="flex items-center gap-2 text-[12px]">
        {extra}
        {paper.status !== "new" ? <Badge>{t(`litsearch.mark.${paper.status}`)}</Badge> : null}
        <span className="text-muted">{t(`litsearch.section.${paper.section}` as MessageKey)}</span>
        <span className="font-mono">{paper.score.toFixed(1)}</span>
      </div>
    </li>
  );
}

/** Two runs side by side: new, dropped and re-ranked papers. */
export function LitsearchCompareScreen({ a, b }: { a: string; b: string }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const same = a === b;
  const diff = useOp(litsearchCompare, { a, b }, { enabled: !same && Boolean(a && b) });
  const runA = useOp(litsearchGet, { runId: a }, { enabled: Boolean(a) });
  const runB = useOp(litsearchGet, { runId: b }, { enabled: Boolean(b) });

  const header = (
    <HeaderSlot>
      <Link to="/litsearch" className="text-[13px] font-medium hover:underline">
        {t("litsearch.title")}
      </Link>
      <span className="text-[13px] text-muted">/</span>
      <span className="text-[13px] font-medium">{t("litsearch.compare.title")}</span>
    </HeaderSlot>
  );
  const side = (label: string, id: string, data: typeof runA.data) => (
    <div className="flex min-w-0 flex-col">
      <Label>{label}</Label>
      <Link to="/litsearch/$runId" params={{ runId: id }} className="truncate hover:underline">
        {data ? `${data.run.topic} · ${when(data.run)}` : id}
      </Link>
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      {header}
      <SubBar className="items-center">
        <div className="flex min-w-0 items-center gap-6">
          {side(t("litsearch.compare.from"), a, runA.data)}
          {side(t("litsearch.compare.to"), b, runB.data)}
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void navigate({ to: "/litsearch/compare", search: { a: b, b: a } })}
        >
          <ArrowLeftRight className="size-3.5" />
          {t("litsearch.compare.swap")}
        </Button>
      </SubBar>
      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-8 py-6">
        {same ? (
          <p className="text-muted">{t("litsearch.compare.same")}</p>
        ) : diff.isPending ? (
          <Loading label={t("common.loading")} />
        ) : diff.isError ? (
          <ErrorState error={diff.error} />
        ) : (
          <>
            <Group
              testId="compare-added"
              label={t("litsearch.compare.added")}
              description={t("litsearch.compare.addedDesc")}
              count={diff.data.added.length}
            >
              <ul>
                {diff.data.added.map((p) => (
                  <Row key={p.key} paper={p} />
                ))}
              </ul>
            </Group>
            <Group
              testId="compare-dropped"
              label={t("litsearch.compare.dropped")}
              description={t("litsearch.compare.droppedDesc")}
              count={diff.data.dropped.length}
            >
              <ul>
                {diff.data.dropped.map((p) => (
                  <Row key={p.key} paper={p} />
                ))}
              </ul>
            </Group>
            <Group
              testId="compare-moved"
              label={t("litsearch.compare.moved")}
              description={t("litsearch.compare.movedDesc")}
              count={diff.data.moved.length}
            >
              <ul>
                {diff.data.moved.map((m) => (
                  <Row
                    key={m.paper.key}
                    paper={m.paper}
                    extra={
                      <span className="inline-flex items-center gap-1 font-mono">
                        {m.to < m.from ? (
                          <ArrowUp className="size-3" />
                        ) : (
                          <ArrowDown className="size-3" />
                        )}
                        {t("litsearch.compare.rank", { from: m.from, to: m.to })}
                      </span>
                    }
                  />
                ))}
              </ul>
            </Group>
          </>
        )}
      </div>
    </div>
  );
}
