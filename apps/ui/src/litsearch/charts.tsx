import type { LitsearchPaper } from "@citegeist/ops";
import type { ReactNode } from "react";
import { Label } from "../components/layout";
import { type MessageKey, useI18n } from "../i18n";

// The four charts of research-pipeline's results view, drawn as plain SVG in the citegeist tokens.
// Colors come from CSS variables, so light and dark mode both work.

export const SCORE_PARTS = ["relevance", "venue", "author", "citations"] as const;
export type ScorePart = (typeof SCORE_PARTS)[number];

/** One card color per score part; each has a light and a dark value in styles.css. */
export const PART_COLOR: Record<ScorePart, string> = {
  relevance: "var(--card-none)",
  venue: "var(--card-thesis)",
  author: "var(--card-definition)",
  citations: "var(--card-finding)",
};

function Chart({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <figure className="flex min-w-0 flex-col gap-2">
      <figcaption className="flex flex-col">
        <Label>{title}</Label>
        <span className="text-[12px] text-muted">{description}</span>
      </figcaption>
      {children}
    </figure>
  );
}

function NoData() {
  const { t } = useI18n();
  return <p className="py-6 text-[12px] text-muted">{t("litsearch.chart.noData")}</p>;
}

const W = 360;
const H = 160;
const PAD = { l: 28, r: 8, t: 8, b: 22 };

/** Vertical bars with a label under each bar and the value on top. */
function Bars({ bars, label }: { bars: Array<{ key: string; value: number }>; label: string }) {
  const max = Math.max(1, ...bars.map((b) => b.value));
  const inner = W - PAD.l - PAD.r;
  const step = inner / Math.max(1, bars.length);
  const bw = Math.max(4, Math.min(28, step * 0.7));
  const y = (v: number) => PAD.t + (H - PAD.t - PAD.b) * (1 - v / max);
  const every = Math.ceil(bars.length / 12);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} className="w-full max-w-[420px]">
      <line x1={PAD.l} x2={W - PAD.r} y1={H - PAD.b} y2={H - PAD.b} stroke="var(--line-faint)" />
      {bars.map((b, i) => {
        const x = PAD.l + step * i + (step - bw) / 2;
        return (
          <g key={b.key}>
            <title>{`${b.key}: ${b.value}`}</title>
            <rect
              x={x}
              y={y(b.value)}
              width={bw}
              height={H - PAD.b - y(b.value)}
              fill="var(--ink)"
            />
            {b.value > 0 ? (
              <text
                x={x + bw / 2}
                y={y(b.value) - 3}
                textAnchor="middle"
                className="fill-muted font-mono text-[9px]"
              >
                {b.value}
              </text>
            ) : null}
            {i % every === 0 ? (
              <text
                x={x + bw / 2}
                y={H - 6}
                textAnchor="middle"
                className="fill-muted font-mono text-[9px]"
              >
                {b.key}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

function PapersPerYear({ papers }: { papers: readonly LitsearchPaper[] }) {
  const { t } = useI18n();
  const years = papers
    .filter((p) => (p.section === "main" || p.section === "preprint") && p.year !== undefined)
    .map((p) => p.year as number);
  if (years.length === 0) return <NoData />;
  const min = Math.min(...years);
  const max = Math.max(...years);
  const bars = Array.from({ length: max - min + 1 }, (_, i) => ({
    key: String(min + i),
    value: years.filter((y) => y === min + i).length,
  }));
  return <Bars bars={bars} label={t("litsearch.chart.years")} />;
}

function Tiers({ papers }: { papers: readonly LitsearchPaper[] }) {
  const { t } = useI18n();
  const main = papers.filter((p) => p.section === "main");
  if (main.length === 0) return <NoData />;
  const bars = [
    { key: t("litsearch.results.tier1"), value: main.filter((p) => p.venueTier === 1).length },
    { key: t("litsearch.results.tier2"), value: main.filter((p) => p.venueTier === 2).length },
    {
      key: t("litsearch.results.tierNone"),
      value: main.filter((p) => p.venueTier !== 1 && p.venueTier !== 2).length,
    },
  ];
  return <Bars bars={bars} label={t("litsearch.chart.tiers")} />;
}

/** Horizontal stacked bars: the four parts of each of the 15 best scores. */
function ScoreComposition({ papers }: { papers: readonly LitsearchPaper[] }) {
  const { t } = useI18n();
  const top = papers
    .filter((p) => p.section === "main")
    .sort((a, b) => b.score - a.score)
    .slice(0, 15);
  if (top.length === 0) return <NoData />;
  const row = 14;
  const h = top.length * row + 8;
  const label = 26;
  const scale = (W - label - PAD.r) / 100;
  return (
    <div className="flex flex-col gap-2">
      <svg
        viewBox={`0 0 ${W} ${h}`}
        role="img"
        aria-label={t("litsearch.chart.score")}
        className="w-full max-w-[420px]"
      >
        {top.map((p, i) => {
          let x = label;
          const y = 4 + i * row;
          return (
            <g key={p.key}>
              <title>{`${p.rank ?? ""}. ${p.title}: ${p.score.toFixed(1)}`}</title>
              <text
                x={label - 4}
                y={y + 9}
                textAnchor="end"
                className="fill-muted font-mono text-[9px]"
              >
                {p.rank ?? i + 1}
              </text>
              {SCORE_PARTS.map((part) => {
                const w = Math.max(0, p.scoreParts[part]) * scale;
                const rect = (
                  <rect key={part} x={x} y={y} width={w} height={row - 4} fill={PART_COLOR[part]} />
                );
                x += w;
                return rect;
              })}
            </g>
          );
        })}
      </svg>
      <Legend />
    </div>
  );
}

export function Legend() {
  const { t } = useI18n();
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted">
      {SCORE_PARTS.map((part) => (
        <li key={part} className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block size-2.5"
            style={{ background: PART_COLOR[part] }}
          />
          {t(`litsearch.detail.part.${part}` as MessageKey)}
        </li>
      ))}
    </ul>
  );
}

/** Year against citations per year, log scale; one dot per peer-reviewed paper. */
function CitationsScatter({ papers }: { papers: readonly LitsearchPaper[] }) {
  const { t } = useI18n();
  const dots = papers.filter(
    (p) => p.section === "main" && p.year !== undefined && p.citationsPerYear !== undefined,
  );
  if (dots.length === 0) return <NoData />;
  const years = dots.map((p) => p.year as number);
  const y0 = Math.min(...years);
  const y1 = Math.max(...years);
  const maxLog = Math.max(1, ...dots.map((p) => Math.log10(1 + (p.citationsPerYear as number))));
  // inset so dots at the first and last year clear the axis labels
  const left = PAD.l + 10;
  const right = W - PAD.r - 14;
  const x = (yr: number) => left + (right - left) * (y1 === y0 ? 0.5 : (yr - y0) / (y1 - y0));
  const y = (c: number) => PAD.t + (H - PAD.t - PAD.b) * (1 - Math.log10(1 + c) / maxLog);
  const ticks = [0, 1, 10, 100, 1000].filter((c) => Math.log10(1 + c) <= maxLog + 0.01);
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={t("litsearch.chart.citations")}
      className="w-full max-w-[420px]"
    >
      <line x1={PAD.l} x2={W - PAD.r} y1={H - PAD.b} y2={H - PAD.b} stroke="var(--line-faint)" />
      {ticks.map((c) => (
        <text
          key={c}
          x={PAD.l - 4}
          y={y(c) + 3}
          textAnchor="end"
          className="fill-muted font-mono text-[9px]"
        >
          {c}
        </text>
      ))}
      {[y0, y1].map((yr) => (
        <text
          key={yr}
          x={x(yr)}
          y={H - 6}
          textAnchor="middle"
          className="fill-muted font-mono text-[9px]"
        >
          {yr}
        </text>
      ))}
      {dots.map((p) => (
        <circle
          key={p.key}
          cx={x(p.year as number)}
          cy={y(p.citationsPerYear as number)}
          r={3}
          fill="var(--ink)"
          fillOpacity={0.7}
        >
          <title>{`${p.title} (${p.year}): ${(p.citationsPerYear as number).toFixed(1)}`}</title>
        </circle>
      ))}
    </svg>
  );
}

/** The four charts in a responsive grid. */
export function ResultCharts({ papers }: { papers: readonly LitsearchPaper[] }) {
  const { t } = useI18n();
  return (
    <div className="grid grid-cols-1 gap-8 xl:grid-cols-2">
      <Chart title={t("litsearch.chart.years")} description={t("litsearch.chart.yearsDesc")}>
        <PapersPerYear papers={papers} />
      </Chart>
      <Chart title={t("litsearch.chart.tiers")} description={t("litsearch.chart.tiersDesc")}>
        <Tiers papers={papers} />
      </Chart>
      <Chart title={t("litsearch.chart.score")} description={t("litsearch.chart.scoreDesc")}>
        <ScoreComposition papers={papers} />
      </Chart>
      <Chart
        title={t("litsearch.chart.citations")}
        description={t("litsearch.chart.citationsDesc")}
      >
        <CitationsScatter papers={papers} />
      </Chart>
    </div>
  );
}
