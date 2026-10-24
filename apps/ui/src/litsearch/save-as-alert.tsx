import { alertsCreate, type LitsearchRunSummary } from "@citegeist/ops";
import { Link } from "@tanstack/react-router";
import { Bell } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import { everyLabel } from "../alerts";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Select } from "../components/ui/select";
import { useI18n } from "../i18n";
import { useOpMutation } from "../lib/hooks";
import { ErrorLine, FieldLabel, useGuarded } from "../settings/parts";

const INTERVALS = [168, 336, 720] as const;

/**
 * "Save as alert" on a finished run: the search becomes an alert of the kind pipeline. The alert
 * runs it again at its interval and puts the papers that are new since this run into the inbox.
 */
export function SaveAsAlert({ run }: { run: LitsearchRunSummary }) {
  const { t } = useI18n();
  const create = useOpMutation(alertsCreate);
  const guard = useGuarded();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(run.topic);
  const [interval, setIntervalHours] = useState("168");
  const [limit, setLimit] = useState("10");
  const [invalid, setInvalid] = useState<string>();
  const [created, setCreated] = useState<string>();
  const nameId = useId();
  const limitId = useId();

  if (created) {
    return (
      <p role="status" className="text-[13px]">
        {t("litsearch.alert.created", { name: created })}{" "}
        <Link to="/settings" search={{ section: "alerts" }} className="underline">
          {t("litsearch.alert.open")}
        </Link>
      </p>
    );
  }
  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)}>
        <Bell className="size-3.5" />
        {t("litsearch.alert.save")}
      </Button>
    );
  }
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setInvalid(undefined);
    const count = Number(limit);
    if (name.trim() === "") return setInvalid(t("alerts.create.nameMissing"));
    if (!Number.isInteger(count) || count < 1 || count > 50) {
      return setInvalid(t("alerts.create.limitInvalid"));
    }
    const out = await guard.run(() =>
      create.mutateAsync({
        name: name.trim(),
        source: {
          kind: "pipeline",
          value: run.topic,
          pipeline: {
            queries: run.queries,
            ...(run.since !== undefined ? { since: run.since } : {}),
            ...(run.top !== undefined ? { top: run.top } : {}),
            fromRun: run.id,
          },
        },
        intervalHours: Number(interval),
        limit: count,
        rank: false,
      }),
    );
    if (out) setCreated(out.name);
  };
  return (
    <form
      aria-label={t("litsearch.alert.title")}
      onSubmit={(e) => void submit(e)}
      className="flex max-w-[720px] flex-col gap-3 border border-line p-4"
    >
      <p className="font-medium">{t("litsearch.alert.title")}</p>
      <p className="text-[12px] text-muted">{t("litsearch.alert.hint")}</p>
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
          <FieldLabel>{t("alerts.create.interval")}</FieldLabel>
          <Select
            label={t("alerts.create.interval")}
            value={interval}
            onChange={setIntervalHours}
            options={INTERVALS.map((h) => ({ value: String(h), label: everyLabel(h, t) }))}
            className="w-36"
          />
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
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm" variant="primary" disabled={create.isPending}>
          {t("litsearch.alert.create")}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          {t("common.cancel")}
        </Button>
      </div>
      <ErrorLine error={invalid ?? guard.error} />
    </form>
  );
}
