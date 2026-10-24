import {
  ALERT_SOURCE_KINDS,
  type AlertInfo,
  type AlertSourceKind,
  alertsCreate,
  alertsDelete,
  alertsList,
  alertsRunNow,
  alertsUpdate,
  jobsGet,
} from "@citegeist/ops";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { type FormEvent, useEffect, useId, useState } from "react";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Select } from "../components/ui/select";
import { ErrorState, Loading } from "../components/ui/states";
import { type MessageKey, useI18n } from "../i18n";
import { useOp, useOpMutation } from "../lib/hooks";
import { pollConfig } from "../onboarding/parts";
import { ErrorLine, FieldLabel, Section, useGuarded } from "../settings/parts";

type Alert = AlertInfo;
type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

const INTERVALS = [6, 12, 24, 72, 168] as const;

export function everyLabel(hours: number, t: Translate): string {
  if (hours === 24) return t("alerts.every.daily");
  if (hours === 168) return t("alerts.every.weekly");
  if (hours % 24 === 0) return t("alerts.every.days", { n: hours / 24 });
  return t("alerts.every.hours", { n: hours });
}

function stamp(iso: string, lang: string): string {
  return new Date(iso).toLocaleString(lang, { dateStyle: "medium", timeStyle: "short" });
}

/** Watches a run that was started: reads the job until it ends. */
function useRunWatch(job: string | undefined) {
  const query = useOp(
    jobsGet,
    { job: job ?? "j_00000000000000000000000000" },
    {
      enabled: job !== undefined,
      refetchInterval: (q) => {
        const status = q.state.data?.status;
        return status === "succeeded" || status === "failed" || status === "cancelled"
          ? false
          : pollConfig.ms;
      },
    },
  );
  const status = job !== undefined ? query.data?.status : undefined;
  const ended = status === "succeeded" || status === "failed" || status === "cancelled";
  const error = query.data?.error?.message;
  return { running: job !== undefined && !ended, ended, status, error };
}

function AlertRow({ alert, showScope }: { alert: Alert; showScope: boolean }) {
  const { t, lang } = useI18n();
  const queryClient = useQueryClient();
  const run = useOpMutation(alertsRunNow);
  const update = useOpMutation(alertsUpdate);
  const remove = useOpMutation(alertsDelete);
  const guard = useGuarded();
  const [job, setJob] = useState<string>();
  const [confirm, setConfirm] = useState(false);
  const [outcome, setOutcome] = useState<string>();

  const watch = useRunWatch(job);
  useEffect(() => {
    if (!watch.ended) return;
    // The run wrote its result to the alert and the inbox, so everything shown is read again.
    void queryClient.invalidateQueries({ queryKey: ["op"] });
    setOutcome(
      watch.status === "succeeded"
        ? t("alerts.runDone")
        : t("alerts.runError", { error: watch.error ?? "" }),
    );
    setJob(undefined);
  }, [watch.ended, watch.status, watch.error, t, queryClient]);

  const start = async () => {
    setOutcome(undefined);
    const out = await guard.run(() => run.mutateAsync({ id: alert.id }));
    if (out) setJob(out.job);
  };
  const toggle = () =>
    void guard.run(() => update.mutateAsync({ id: alert.id, patch: { enabled: !alert.enabled } }));
  const destroy = async () => {
    await guard.run(() => remove.mutateAsync({ id: alert.id }));
  };

  const last = alert.lastRun;
  return (
    <li
      data-testid="alert"
      data-id={alert.id}
      className="flex flex-col gap-2 border border-line bg-surface p-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{alert.name}</span>
        {showScope ? (
          <Badge tone="neutral">
            {alert.project
              ? t("alerts.scope.project", { project: alert.project })
              : t("alerts.scope.library")}
          </Badge>
        ) : null}
        {alert.enabled ? null : <Badge tone="outline">{t("alerts.paused")}</Badge>}
      </div>
      <p className="text-sm text-muted">
        {t(`alerts.kind.${alert.source.kind}` as MessageKey)}:{" "}
        <span className="font-mono text-[12px]">{alert.source.value}</span>
        {" · "}
        {everyLabel(alert.intervalHours, t)}
        {" · "}
        {t("alerts.limit", { n: alert.limit })}
      </p>
      {alert.source.pipeline ? (
        <p className="truncate font-mono text-[12px] text-muted">
          {alert.source.pipeline.queries.join("  ·  ")}
        </p>
      ) : null}
      {last ? (
        <p className="text-sm" data-testid="alert-last-run">
          {last.ok ? (
            <>
              {t("alerts.lastRun", { at: stamp(last.at, lang) })}
              {". "}
              {t("alerts.result", { found: last.found, added: last.added })}
              {last.ranked ? ` (${t("alerts.ranked")})` : ""}
              {last.runId ? (
                <>
                  {" "}
                  <Link to="/litsearch/$runId" params={{ runId: last.runId }} className="underline">
                    {t("alerts.openRun")}
                  </Link>
                </>
              ) : null}
            </>
          ) : (
            <span className="text-danger">
              {t("alerts.runFailed", { error: last.error ?? "" })}
            </span>
          )}
        </p>
      ) : (
        <p className="text-sm text-muted">{t("alerts.neverRun")}</p>
      )}
      {alert.nextRun && !watch.running ? (
        <p className="text-sm text-muted">{t("alerts.next", { at: stamp(alert.nextRun, lang) })}</p>
      ) : null}
      {outcome ? (
        <p role="status" className="text-sm text-muted">
          {outcome}
        </p>
      ) : null}

      {confirm ? (
        <div className="flex flex-wrap items-center gap-2">
          <span>{t("alerts.delete.ask", { name: alert.name })}</span>
          <Button variant="primary" disabled={remove.isPending} onClick={() => void destroy()}>
            {t("alerts.delete.confirm")}
          </Button>
          <Button onClick={() => setConfirm(false)}>{t("common.cancel")}</Button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button disabled={watch.running || run.isPending} onClick={() => void start()}>
            {watch.running ? t("alerts.running") : t("alerts.run")}
          </Button>
          <Button disabled={update.isPending} onClick={toggle}>
            {alert.enabled ? t("alerts.pause") : t("alerts.resume")}
          </Button>
          <Button onClick={() => setConfirm(true)}>{t("alerts.delete")}</Button>
        </div>
      )}
      <ErrorLine error={guard.error} />
    </li>
  );
}

function CreateForm({ project }: { project: string | undefined }) {
  const { t } = useI18n();
  const create = useOpMutation(alertsCreate);
  const guard = useGuarded();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<AlertSourceKind>("arxiv-category");
  const [value, setValue] = useState("");
  const [interval, setIntervalHours] = useState("24");
  const [limit, setLimit] = useState("5");
  const [rank, setRank] = useState(true);
  const [invalid, setInvalid] = useState<string>();
  const nameId = useId();
  const valueId = useId();
  const limitId = useId();
  const rankId = useId();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setInvalid(undefined);
    const count = Number(limit);
    if (name.trim() === "") return setInvalid(t("alerts.create.nameMissing"));
    if (value.trim() === "") return setInvalid(t("alerts.create.valueMissing"));
    if (!Number.isInteger(count) || count < 1 || count > 50) {
      return setInvalid(t("alerts.create.limitInvalid"));
    }
    const out = await guard.run(() =>
      create.mutateAsync({
        name: name.trim(),
        source: { kind, value: value.trim() },
        intervalHours: Number(interval),
        limit: count,
        ...(project ? { project, rank } : { rank: false }),
      }),
    );
    if (out) {
      setName("");
      setValue("");
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3 border border-line p-3">
      <h3 className="font-medium">{t("alerts.create.title")}</h3>
      <div className="flex flex-col gap-1">
        <FieldLabel htmlFor={nameId}>{t("alerts.create.name")}</FieldLabel>
        <Input
          id={nameId}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="max-w-sm"
        />
      </div>
      <div className="flex flex-wrap gap-3">
        <div className="flex flex-col gap-1">
          <FieldLabel>{t("alerts.create.kind")}</FieldLabel>
          <Select
            label={t("alerts.create.kind")}
            value={kind}
            onChange={(next) => setKind(next as AlertSourceKind)}
            options={ALERT_SOURCE_KINDS.filter((k) => k !== "pipeline").map((k) => ({
              value: k,
              label: t(`alerts.kind.${k}` as MessageKey),
            }))}
            className="w-44"
          />
        </div>
        <div className="flex flex-col gap-1">
          <FieldLabel>{t("alerts.create.interval")}</FieldLabel>
          <Select
            label={t("alerts.create.interval")}
            value={interval}
            onChange={setIntervalHours}
            options={INTERVALS.map((h) => ({ value: String(h), label: everyLabel(h, t) }))}
            className="w-36"
          />
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <FieldLabel htmlFor={valueId}>{t("alerts.create.value")}</FieldLabel>
        <Input
          id={valueId}
          value={value}
          placeholder={t(`alerts.hint.${kind}` as MessageKey)}
          onChange={(e) => setValue(e.target.value)}
          className="max-w-md font-mono"
        />
        <p className="text-sm text-muted">{t(`alerts.hint.${kind}` as MessageKey)}</p>
      </div>
      <div className="flex flex-col gap-1">
        <FieldLabel htmlFor={limitId}>{t("alerts.create.limit")}</FieldLabel>
        <Input
          id={limitId}
          inputMode="numeric"
          value={limit}
          onChange={(e) => setLimit(e.target.value)}
          className="w-24"
        />
      </div>
      {project ? (
        <label htmlFor={rankId} className="flex items-center gap-2">
          <input
            id={rankId}
            type="checkbox"
            checked={rank}
            onChange={(e) => setRank(e.target.checked)}
          />
          {t("alerts.create.rank")}
        </label>
      ) : null}
      <div>
        <Button type="submit" variant="primary" disabled={create.isPending}>
          {t("alerts.create.submit")}
        </Button>
      </div>
      <ErrorLine error={invalid ?? guard.error} />
    </form>
  );
}

/**
 * The alerts of one project (`project` set) or of the whole library (settings): the list with the
 * last run of each, a button to run one now, and the form for a new one.
 */
export function AlertsPanel({ project }: { project?: string }) {
  const { t } = useI18n();
  const query = useOp(alertsList, project ? { project } : {});
  if (query.isPending) return <Loading label={t("alerts.loading")} />;
  if (query.isError) return <ErrorState error={query.error} />;
  const { alerts } = query.data;
  return (
    <div className="flex flex-col gap-3">
      {alerts.length === 0 ? (
        <p className="text-muted">{t("alerts.empty")}</p>
      ) : (
        <ul aria-label={t("alerts.list")} className="flex flex-col gap-3">
          {alerts.map((alert) => (
            <AlertRow key={alert.id} alert={alert} showScope={project === undefined} />
          ))}
        </ul>
      )}
      <CreateForm project={project} />
    </div>
  );
}

/** The alerts section of the settings: every alert of the library, with the project it belongs to. */
export function AlertsSection() {
  const { t } = useI18n();
  return (
    <Section id="alerts-list" title={t("alerts.title")} description={t("alerts.descLibrary")}>
      <AlertsPanel />
    </Section>
  );
}
