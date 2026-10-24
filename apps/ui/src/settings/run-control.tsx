import { type settingsGet, settingsUpdate, usageSummary } from "@citegeist/ops";
import { type FormEvent, useEffect, useState } from "react";
import type { z } from "zod";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Segmented } from "../components/ui/segmented";
import { type MessageKey, useI18n } from "../i18n";
import { useOp, useOpMutation } from "../lib/hooks";
import { describeError } from "../lib/utils";
import { FieldLabel } from "./parts";

type Totals = z.output<typeof usageSummary.output>["totals"];
type SettingsData = z.output<typeof settingsGet.output>;

const PERIODS = ["7", "30"] as const;
type Period = (typeof PERIODS)[number];

function tokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} Mio.`;
  if (n >= 10_000) return `${Math.round(n / 1000)} Tsd.`;
  return String(n);
}

function dollars(n: number): string {
  if (n === 0) return "0 $";
  return `${n < 0.01 ? n.toFixed(4) : n.toFixed(2)} $`;
}

function Row({ name, totals, strong }: { name: string; totals: Totals; strong?: boolean }) {
  const cell = "px-2 py-1 text-right tabular-nums";
  return (
    <tr className={strong ? "border-t border-line font-semibold" : undefined}>
      <th scope="row" className="px-2 py-1 text-left font-normal">
        {strong ? <span className="font-semibold">{name}</span> : name}
      </th>
      <td className={cell}>{totals.calls}</td>
      <td className={cell}>{tokens(totals.inputTokens)}</td>
      <td className={cell}>{tokens(totals.outputTokens)}</td>
      <td className={cell}>{tokens(totals.cacheReadTokens)}</td>
      <td className={cell}>{totals.pricedCalls > 0 ? dollars(totals.costUsd) : "-"}</td>
    </tr>
  );
}

function Table({
  caption,
  rows,
  total,
}: {
  caption: string;
  rows: Array<{ name: string; totals: Totals }>;
  total?: Totals;
}) {
  const { t } = useI18n();
  const head = "px-2 py-1 text-right text-[11px] font-semibold uppercase tracking-[0.1em]";
  return (
    <table className="w-full border-collapse text-sm">
      <caption className="pb-1 text-left text-[11px] font-semibold uppercase tracking-[0.1em]">
        {caption}
      </caption>
      <thead>
        <tr>
          <th scope="col" className="sr-only">
            {caption}
          </th>
          <th scope="col" className={head}>
            {t("settings.usage.col.calls")}
          </th>
          <th scope="col" className={head}>
            {t("settings.usage.col.input")}
          </th>
          <th scope="col" className={head}>
            {t("settings.usage.col.output")}
          </th>
          <th scope="col" className={head}>
            {t("settings.usage.col.cache")}
          </th>
          <th scope="col" className={head}>
            {t("settings.usage.col.cost")}
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <Row key={r.name} name={r.name} totals={r.totals} />
        ))}
        {total ? <Row name={t("settings.usage.total")} totals={total} strong /> : null}
      </tbody>
    </table>
  );
}

/** Verbrauch: tokens, cache hits and list price of the last 7 or 30 days, per task and backend. */
export function UsagePanel() {
  const { t, has } = useI18n();
  const [period, setPeriod] = useState<Period>("7");
  const query = useOp(usageSummary, { days: Number(period) });
  const taskName = (task: string) => (has(`task.${task}`) ? t(`task.${task}` as MessageKey) : task);

  let body: React.ReactNode;
  if (query.isError) {
    body = (
      <p role="alert" className="text-sm text-danger">
        {t("settings.usage.loadError")}
      </p>
    );
  } else if (query.isPending) {
    body = null;
  } else if (query.data.totals.calls === 0) {
    body = <p className="text-sm text-muted">{t("settings.usage.empty")}</p>;
  } else {
    const { totals, byTask, byBackend } = query.data;
    body = (
      <div className="flex flex-col gap-4">
        <Table
          caption={t("settings.usage.byTask")}
          rows={byTask.map((r) => ({ name: taskName(r.task), totals: r }))}
          total={totals}
        />
        <Table
          caption={t("settings.usage.byBackend")}
          rows={byBackend.map((r) => ({ name: r.backend, totals: r }))}
        />
        {totals.failed > 0 ? (
          <p className="text-sm text-muted">{t("settings.usage.failed", { n: totals.failed })}</p>
        ) : null}
        {totals.pricedCalls < totals.calls ? (
          <p className="text-sm text-muted">
            {t("settings.usage.partialCost", {
              missing: totals.calls - totals.pricedCalls,
              calls: totals.calls,
            })}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <Segmented<Period>
        label={t("settings.usage.period")}
        value={period}
        options={PERIODS.map((value) => ({ value, label: t(`settings.usage.days${value}`) }))}
        onChange={setPeriod}
      />
      {body}
      <p className="text-sm text-muted">{t("settings.usage.subscription")}</p>
    </div>
  );
}

/** Limits of research jobs: minutes, tokens and tool calls. */
export function ResearchLimitsPanel({ data }: { data: SettingsData }) {
  const { t } = useI18n();
  const update = useOpMutation(settingsUpdate);
  const current = data.settings.research;
  const [minutes, setMinutes] = useState(String(current.maxMinutes));
  const [tokenLimit, setTokenLimit] = useState(String(current.maxTokens));
  const [toolCalls, setToolCalls] = useState(String(current.maxToolCalls));
  const [error, setError] = useState<string>();
  useEffect(() => {
    setMinutes(String(current.maxMinutes));
    setTokenLimit(String(current.maxTokens));
    setToolCalls(String(current.maxToolCalls));
  }, [current.maxMinutes, current.maxTokens, current.maxToolCalls]);

  const changed =
    minutes.trim() !== String(current.maxMinutes) ||
    tokenLimit.trim() !== String(current.maxTokens) ||
    toolCalls.trim() !== String(current.maxToolCalls);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(undefined);
    const next = [minutes, tokenLimit, toolCalls].map((v) => Number(v.trim()));
    if (
      next.some((n, i) => !Number.isInteger(n) || n < 0 || (i === 0 && n > 1440)) ||
      next.some(Number.isNaN)
    ) {
      setError(t("settings.research.invalid"));
      return;
    }
    try {
      await update.mutateAsync({
        patch: {
          research: { maxMinutes: next[0], maxTokens: next[1], maxToolCalls: next[2] },
        },
      });
    } catch (err) {
      const { message, fix } = describeError(err);
      setError(fix ? `${message} ${fix}` : message);
    }
  };

  const field = (id: string, label: string, value: string, set: (v: string) => void) => (
    <div className="flex items-center justify-between gap-4">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        inputMode="numeric"
        value={value}
        onChange={(e) => set(e.target.value)}
        className="w-32 text-right"
      />
    </div>
  );

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-2">
      {field("research-minutes", t("settings.research.minutes"), minutes, setMinutes)}
      {field("research-tokens", t("settings.research.tokens"), tokenLimit, setTokenLimit)}
      <p className="text-sm text-muted">{t("settings.research.tokensHint")}</p>
      {field("research-tool-calls", t("settings.research.toolCalls"), toolCalls, setToolCalls)}
      <p className="text-sm text-muted">{t("settings.research.loop")}</p>
      <div>
        <Button type="submit" disabled={update.isPending || !changed}>
          {t("settings.research.save")}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </form>
  );
}
