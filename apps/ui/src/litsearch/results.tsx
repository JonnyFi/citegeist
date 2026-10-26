import {
  itemsAdd,
  type LitsearchPaper,
  type LitsearchSection,
  litsearchExport,
  litsearchReport,
  litsearchToInbox,
} from "@citegeist/ops";
import { Link } from "@tanstack/react-router";
import { ArrowDown, ArrowUp, Download, ExternalLink } from "lucide-react";
import { useMemo, useState } from "react";
import { Label } from "../components/layout";
import { Badge, Stamp } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Segmented } from "../components/ui/segmented";
import { type MessageKey, useI18n } from "../i18n";
import { useCore, useOpMutation } from "../lib/hooks";
import { webUrl } from "../lib/safe-url";
import { cn } from "../lib/utils";
import { ErrorLine, useGuarded } from "../settings/parts";
import { PART_COLOR, SCORE_PARTS } from "./charts";

const SECTIONS: readonly LitsearchSection[] = ["main", "preprint", "grey", "rejected"];
type SortKey = "rank" | "score" | "title" | "year" | "venue" | "citedBy";
type Tier = "all" | "1" | "2" | "none";

export interface Filters {
  q: string;
  yearFrom: string;
  yearTo: string;
  minScore: string;
  tier: Tier;
}
const NO_FILTERS: Filters = { q: "", yearFrom: "", yearTo: "", minScore: "", tier: "all" };

/** Papers of one section that pass the filters. Exported for the tests. */
export function applyFilters(papers: readonly LitsearchPaper[], f: Filters): LitsearchPaper[] {
  const q = f.q.trim().toLowerCase();
  const from = f.yearFrom.trim() ? Number(f.yearFrom) : undefined;
  const to = f.yearTo.trim() ? Number(f.yearTo) : undefined;
  const min = f.minScore.trim() ? Number(f.minScore) : undefined;
  return papers.filter((p) => {
    if (q && !`${p.title} ${p.authors.join(" ")} ${p.venue}`.toLowerCase().includes(q))
      return false;
    if (from !== undefined && !Number.isNaN(from) && (p.year === undefined || p.year < from))
      return false;
    if (to !== undefined && !Number.isNaN(to) && (p.year === undefined || p.year > to))
      return false;
    if (min !== undefined && !Number.isNaN(min) && p.score < min) return false;
    if (f.tier === "1" && p.venueTier !== 1) return false;
    if (f.tier === "2" && p.venueTier !== 2) return false;
    if (f.tier === "none" && (p.venueTier === 1 || p.venueTier === 2)) return false;
    return true;
  });
}

function compare(key: SortKey): (a: LitsearchPaper, b: LitsearchPaper) => number {
  const num = (v: number | undefined, missing: number) => v ?? missing;
  switch (key) {
    case "rank":
      return (a, b) => num(a.rank, 1e9) - num(b.rank, 1e9) || b.score - a.score;
    case "score":
      return (a, b) => a.score - b.score;
    case "title":
      return (a, b) => a.title.localeCompare(b.title);
    case "venue":
      return (a, b) => a.venue.localeCompare(b.venue);
    case "year":
      return (a, b) => num(a.year, 0) - num(b.year, 0);
    case "citedBy":
      return (a, b) => num(a.citedBy, -1) - num(b.citedBy, -1);
  }
}

/** Offers a text as a file download; Electron asks where to save it. */
function download(filename: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const EXPORTS = [
  { format: "md", type: "text/markdown" },
  { format: "csv", type: "text/csv" },
  { format: "bib", type: "application/x-bibtex" },
  { format: "summaries", type: "text/markdown" },
] as const;

/** The four exports of the run folder and the HTML report. */
export function Downloads({ runId }: { runId: string }) {
  const { t } = useI18n();
  const core = useCore();
  const guard = useGuarded();
  const [busy, setBusy] = useState<string>();
  const get = (
    key: string,
    fetch: () => Promise<{ filename: string; text: string; type: string }>,
  ) =>
    void guard.run(async () => {
      setBusy(key);
      try {
        const file = await fetch();
        download(file.filename, file.text, file.type);
      } finally {
        setBusy(undefined);
      }
    });
  return (
    <div className="flex flex-col gap-2">
      <Label>{t("litsearch.download")}</Label>
      <div className="flex flex-wrap gap-2">
        {EXPORTS.map((e) => (
          <Button
            key={e.format}
            size="sm"
            disabled={busy !== undefined}
            onClick={() =>
              get(e.format, async () => {
                const out = await core.call(litsearchExport, { runId, format: e.format });
                return { filename: out.filename, text: out.content, type: e.type };
              })
            }
          >
            <Download className="size-3.5" />
            {busy === e.format
              ? t("litsearch.download.busy")
              : t(`litsearch.download.${e.format}` as MessageKey)}
          </Button>
        ))}
        <Button
          size="sm"
          variant="primary"
          disabled={busy !== undefined}
          onClick={() =>
            get("report", async () => {
              const out = await core.call(litsearchReport, { runId });
              return { filename: out.filename, text: out.html, type: "text/html" };
            })
          }
        >
          <Download className="size-3.5" />
          {busy === "report" ? t("litsearch.download.busy") : t("litsearch.download.report")}
        </Button>
      </div>
      <ErrorLine error={guard.error} />
    </div>
  );
}

function Mark({ paper }: { paper: LitsearchPaper }) {
  const { t } = useI18n();
  if (paper.status === "new") return null;
  return (
    <Badge tone={paper.status === "library" ? "outline" : "neutral"}>
      {t(`litsearch.mark.${paper.status}`)}
    </Badge>
  );
}

const TH =
  "h-9 border-b border-line px-3 text-left text-label font-semibold uppercase tracking-[0.08em] text-muted";
const TD = "border-b border-line-soft px-3 py-2 align-top";

/** Section tabs, filters and the sortable table of a finished run. */
/** A paper can be added when the library does not know it yet and it has an id to look it up by. */
export function addable(p: LitsearchPaper): boolean {
  return p.status === "new" && p.section !== "rejected" && Boolean(p.doi || p.arxiv);
}

/** Sends papers to the inbox and says how it went. */
function useToInbox(runId: string) {
  const { t } = useI18n();
  const send = useOpMutation(litsearchToInbox);
  const guard = useGuarded();
  const [result, setResult] = useState<string>();
  const run = async (keys: string[]) => {
    setResult(undefined);
    const out = await guard.run(() => send.mutateAsync({ runId, keys }));
    if (out) {
      setResult(
        t("litsearch.add.result", {
          added: out.added,
          duplicates: out.duplicates,
          failed: out.failed,
        }),
      );
    }
    return out;
  };
  return { run, busy: send.isPending, error: guard.error, result };
}

export function ResultsTable({
  runId,
  papers,
  selected,
  onSelect,
}: {
  runId: string;
  papers: readonly LitsearchPaper[];
  selected: string | undefined;
  onSelect: (key: string) => void;
}) {
  const { t, tn } = useI18n();
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const inbox = useToInbox(runId);
  const [section, setSection] = useState<LitsearchSection>("main");
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "rank", desc: false });
  const inSection = useMemo(() => papers.filter((p) => p.section === section), [papers, section]);
  const shown = useMemo(() => {
    const list = applyFilters(inSection, filters).sort(compare(sort.key));
    return sort.desc ? list.reverse() : list;
  }, [inSection, filters, sort]);
  const set = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }));
  const filtered = JSON.stringify(filters) !== JSON.stringify(NO_FILTERS);
  const choosable = shown.filter(addable);
  const chosen = papers.filter((p) => checked.has(p.key) && addable(p)).map((p) => p.key);
  const allChosen = choosable.length > 0 && choosable.every((p) => checked.has(p.key));
  const toggle = (key: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  const sendChosen = async () => {
    const out = await inbox.run(chosen);
    if (out) setChecked(new Set());
  };

  const head = (key: SortKey, col: MessageKey, className = "") => {
    const active = sort.key === key;
    const name = t(col);
    return (
      <th
        scope="col"
        className={cn(TH, className)}
        aria-sort={active ? (sort.desc ? "descending" : "ascending") : "none"}
      >
        <button
          type="button"
          aria-label={t("litsearch.col.sortBy", { col: name })}
          className="inline-flex items-center gap-1 uppercase hover:text-ink"
          onClick={() =>
            setSort((s) =>
              s.key === key
                ? { key, desc: !s.desc }
                : { key, desc: key === "score" || key === "citedBy" },
            )
          }
        >
          {name}
          {active ? (
            sort.desc ? (
              <ArrowDown className="size-3" />
            ) : (
              <ArrowUp className="size-3" />
            )
          ) : null}
        </button>
      </th>
    );
  };

  return (
    <div className="flex min-w-0 flex-col">
      <div className="flex items-stretch border-b border-line px-8">
        <Segmented
          variant="tabs"
          label={t("litsearch.results.tabs")}
          value={section}
          onChange={setSection}
          className="h-subbar"
          options={SECTIONS.map((s) => ({
            value: s,
            label: t(`litsearch.section.${s}` as MessageKey),
            count: papers.filter((p) => p.section === s).length,
          }))}
        />
      </div>
      <div className="flex flex-wrap items-end gap-3 border-b border-line-soft px-8 py-3">
        <Input
          value={filters.q}
          onChange={(e) => set({ q: e.target.value })}
          aria-label={t("litsearch.results.filter")}
          placeholder={t("litsearch.results.filter")}
          className="w-64"
        />
        <Input
          value={filters.yearFrom}
          inputMode="numeric"
          onChange={(e) => set({ yearFrom: e.target.value })}
          aria-label={t("litsearch.results.yearFrom")}
          placeholder={t("litsearch.results.yearFrom")}
          className="w-24"
        />
        <Input
          value={filters.yearTo}
          inputMode="numeric"
          onChange={(e) => set({ yearTo: e.target.value })}
          aria-label={t("litsearch.results.yearTo")}
          placeholder={t("litsearch.results.yearTo")}
          className="w-24"
        />
        <Input
          value={filters.minScore}
          inputMode="numeric"
          onChange={(e) => set({ minScore: e.target.value })}
          aria-label={t("litsearch.results.minScore")}
          placeholder={t("litsearch.results.minScore")}
          className="w-32"
        />
        <select
          aria-label={t("litsearch.results.tier")}
          value={filters.tier}
          onChange={(e) => set({ tier: e.target.value as Tier })}
          className="h-7 border border-line bg-transparent px-2 text-[13px]"
        >
          <option value="all">{t("litsearch.results.tierAll")}</option>
          <option value="1">{t("litsearch.results.tier1")}</option>
          <option value="2">{t("litsearch.results.tier2")}</option>
          <option value="none">{t("litsearch.results.tierNone")}</option>
        </select>
        {filtered ? (
          <Button size="sm" variant="ghost" onClick={() => setFilters(NO_FILTERS)}>
            {t("litsearch.results.reset")}
          </Button>
        ) : null}
        <span className="ml-auto font-mono text-[12px] text-muted">
          {t("litsearch.results.shown", { n: shown.length, total: inSection.length })}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-3 border-b border-line-soft px-8 py-2">
        <label className="flex cursor-pointer items-center gap-2 text-[12px]">
          <input
            type="checkbox"
            className="size-3.5"
            checked={allChosen}
            disabled={choosable.length === 0}
            aria-label={t("litsearch.selectAll")}
            onChange={() =>
              setChecked((prev) => {
                const next = new Set(prev);
                for (const p of choosable) {
                  if (allChosen) next.delete(p.key);
                  else next.add(p.key);
                }
                return next;
              })
            }
          />
          {chosen.length > 0 ? tn("inbox.selectedCount", chosen.length) : t("inbox.selectAll")}
        </label>
        <Button
          size="sm"
          variant="primary"
          disabled={chosen.length === 0 || inbox.busy}
          onClick={() => void sendChosen()}
        >
          {inbox.busy
            ? t("litsearch.add.busy")
            : t("litsearch.add.inboxSelected", { n: chosen.length })}
        </Button>
        {inbox.result ? (
          <span role="status" className="text-[12px] text-muted">
            {inbox.result}
          </span>
        ) : null}
        <ErrorLine error={inbox.error} />
      </div>
      {inSection.length === 0 ? (
        <p className="px-8 py-6 text-muted">{t("litsearch.results.empty")}</p>
      ) : shown.length === 0 ? (
        <p className="px-8 py-6 text-muted">{t("litsearch.results.none")}</p>
      ) : (
        <table className="w-full border-collapse text-left text-[13px]">
          <thead>
            <tr>
              <th scope="col" className={cn(TH, "w-10 pl-8")}>
                <span className="sr-only">{t("litsearch.selectAll")}</span>
              </th>
              {head("rank", "litsearch.col.rank", "w-14")}
              {head("score", "litsearch.col.score", "w-24")}
              {head("title", "litsearch.col.title")}
              {head("year", "litsearch.col.year", "w-16")}
              {head("venue", "litsearch.col.venue", "hidden w-[220px] lg:table-cell")}
              {section === "rejected" ? (
                <th scope="col" className={cn(TH, "w-[220px] pr-8")}>
                  {t("litsearch.col.reason")}
                </th>
              ) : (
                head("citedBy", "litsearch.col.citations", "w-20 pr-8")
              )}
            </tr>
          </thead>
          <tbody>
            {shown.map((p) => (
              <tr
                key={p.key}
                data-testid="litsearch-paper"
                aria-selected={selected === p.key}
                onClick={() => onSelect(p.key)}
                className={cn("cursor-default hover:bg-sunken", selected === p.key && "bg-sunken")}
              >
                <td className={cn(TD, "pl-8")}>
                  <input
                    type="checkbox"
                    className="mt-0.5 size-3.5"
                    aria-label={t("litsearch.select", { title: p.title })}
                    checked={checked.has(p.key) && addable(p)}
                    disabled={!addable(p)}
                    onClick={(e) => e.stopPropagation()}
                    onChange={() => toggle(p.key)}
                  />
                </td>
                <td className={cn(TD, "font-mono text-[12px] text-muted")}>{p.rank ?? ""}</td>
                <td className={TD}>
                  <ScoreBar paper={p} />
                </td>
                <td className={cn(TD, "max-w-0")}>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelect(p.key);
                    }}
                    className="block w-full truncate text-left font-medium hover:underline"
                  >
                    {p.title}
                  </button>
                  <div className="flex items-center gap-2 text-[12px] text-muted">
                    <span className="truncate">
                      {p.authors.slice(0, 3).join(", ")}
                      {p.authors.length > 3 ? " et al." : ""}
                    </span>
                    <Mark paper={p} />
                    {p.newInAlert ? <Badge tone="accent">{t("litsearch.new.badge")}</Badge> : null}
                    {!p.verified && p.section !== "rejected" ? (
                      <Stamp tone="danger">{t("litsearch.notVerified")}</Stamp>
                    ) : null}
                  </div>
                </td>
                <td className={cn(TD, "font-mono text-[12px]")}>{p.year ?? ""}</td>
                <td className={cn(TD, "hidden truncate lg:table-cell")}>
                  <span className="truncate">{p.venue}</span>
                  {p.venueTier ? (
                    <span className="ml-2 font-mono text-[11px] text-muted">
                      {t("litsearch.tier", { n: p.venueTier })}
                    </span>
                  ) : null}
                </td>
                {section === "rejected" ? (
                  <td className={cn(TD, "pr-8 text-[12px] text-muted")}>
                    {p.rejectedReason ?? ""}
                  </td>
                ) : (
                  <td className={cn(TD, "pr-8 font-mono text-[12px]")}>{p.citedBy ?? ""}</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** Score as a number and a thin bar of its four parts. */
function ScoreBar({ paper }: { paper: LitsearchPaper }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="font-mono text-[12px]">{paper.score.toFixed(1)}</span>
      <div aria-hidden="true" className="flex h-1 w-16 bg-line-soft">
        {SCORE_PARTS.map((part) => (
          <span
            key={part}
            style={{
              width: `${Math.max(0, paper.scoreParts[part])}%`,
              background: PART_COLOR[part],
            }}
          />
        ))}
      </div>
    </div>
  );
}

function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1">
      <Label>{label}</Label>
      <div className="leading-[1.5]">{children}</div>
    </section>
  );
}

/** Everything the run knows about one paper, for the right column. */
/** "Add to library" (the user decides, straight in) and "To the inbox" for one paper. */
function AddActions({ runId, paper }: { runId: string; paper: LitsearchPaper }) {
  const { t } = useI18n();
  const add = useOpMutation(itemsAdd);
  const guard = useGuarded();
  const inbox = useToInbox(runId);
  const [added, setAdded] = useState(false);
  if (added) {
    return (
      <p role="status" className="text-[12px] text-muted">
        {t("litsearch.add.addedLibrary")}
      </p>
    );
  }
  if (!addable(paper)) {
    return paper.status === "new" && paper.section !== "rejected" ? (
      <p className="text-[12px] text-muted">{t("litsearch.add.noId")}</p>
    ) : null;
  }
  const identifier = paper.doi ?? `arXiv:${paper.arxiv}`;
  const busy = add.isPending || inbox.busy;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="primary"
          disabled={busy}
          onClick={() =>
            void guard
              .run(() => add.mutateAsync({ identifier, target: "library" }))
              .then((out) => setAdded(Boolean(out)))
          }
        >
          {add.isPending ? t("litsearch.add.busy") : t("litsearch.add.library")}
        </Button>
        <Button size="sm" disabled={busy} onClick={() => void inbox.run([paper.key])}>
          {t("litsearch.add.inbox")}
        </Button>
      </div>
      <ErrorLine error={guard.error ?? inbox.error} />
    </div>
  );
}

export function PaperDetail({
  runId,
  paper,
}: {
  runId: string;
  paper: LitsearchPaper | undefined;
}) {
  const { t } = useI18n();
  if (!paper) {
    return <p className="p-4 text-muted">{t("litsearch.detail.empty")}</p>;
  }
  const facts = [
    paper.citedBy !== undefined ? t("litsearch.detail.citations", { n: paper.citedBy }) : undefined,
    paper.citationsPerYear !== undefined
      ? t("litsearch.detail.perYear", { n: paper.citationsPerYear.toFixed(1) })
      : undefined,
    paper.fwci !== undefined ? t("litsearch.detail.fwci", { n: paper.fwci.toFixed(2) }) : undefined,
    paper.maxHIndex !== undefined
      ? t("litsearch.detail.hIndex", { n: paper.maxHIndex })
      : undefined,
  ].filter(Boolean);
  return (
    <div
      data-testid="litsearch-detail"
      className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4"
    >
      <div className="flex flex-col gap-1">
        <h2 className="font-serif text-[20px] font-medium leading-tight">{paper.title}</h2>
        <p className="text-muted">{paper.authors.join(", ")}</p>
        <p className="text-muted">
          {[
            paper.venue,
            paper.year,
            paper.venueTier ? t("litsearch.tier", { n: paper.venueTier }) : undefined,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <Mark paper={paper} />
          {paper.citekey ? (
            <Link
              to="/items/$citekey"
              params={{ citekey: paper.citekey }}
              className="text-[12px] underline"
            >
              {t("litsearch.detail.openLibrary")}
            </Link>
          ) : null}
          {webUrl(paper.link) || paper.doi ? (
            <a
              href={webUrl(paper.link) ?? `https://doi.org/${paper.doi}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[12px] underline"
            >
              {t("litsearch.detail.openDoi")}
              <ExternalLink className="size-3" />
            </a>
          ) : null}
          {paper.doi ? <span className="font-mono text-[11px] text-muted">{paper.doi}</span> : null}
        </div>
        <div className="mt-2">
          <AddActions key={paper.key} runId={runId} paper={paper} />
        </div>
      </div>

      <Block label={t("litsearch.detail.score", { score: paper.score.toFixed(1) })}>
        <dl className="flex flex-col gap-1.5">
          {SCORE_PARTS.map((part) => (
            <div
              key={part}
              className="grid grid-cols-[130px_minmax(0,1fr)_40px] items-center gap-2 text-[12px]"
            >
              <dt className="text-muted">{t(`litsearch.detail.part.${part}` as MessageKey)}</dt>
              <dd className="h-1.5 bg-line-soft">
                <span
                  className="block h-full"
                  style={{
                    width: `${Math.min(100, (paper.scoreParts[part] / 30) * 100)}%`,
                    background: PART_COLOR[part],
                  }}
                />
              </dd>
              <dd className="text-right font-mono">{paper.scoreParts[part].toFixed(1)}</dd>
            </div>
          ))}
        </dl>
        {facts.length ? <p className="mt-2 text-[12px] text-muted">{facts.join(" · ")}</p> : null}
      </Block>

      {paper.rejectedReason ? (
        <Block label={t("litsearch.detail.rejected")}>
          <span className="text-danger">{paper.rejectedReason}</span>
        </Block>
      ) : null}
      {paper.why ? <Block label={t("litsearch.detail.why")}>{paper.why}</Block> : null}
      {paper.summary ? <Block label={t("litsearch.detail.summary")}>{paper.summary}</Block> : null}
      {paper.reviewStatus ? (
        <Block label={t("litsearch.detail.review")}>{paper.reviewStatus}</Block>
      ) : null}
      <Block label={t("litsearch.detail.foundVia")}>{paper.foundVia || "query"}</Block>
      {paper.queries.length ? (
        <Block label={t("litsearch.detail.queries")}>
          <ul className="font-mono text-[12px]">
            {paper.queries.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        </Block>
      ) : null}
      {paper.abstract ? (
        <Block label={t("litsearch.detail.abstract")}>
          <p className="text-[13px]">{paper.abstract}</p>
        </Block>
      ) : null}
    </div>
  );
}
