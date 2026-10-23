import { type settingsGet, settingsUpdate } from "@citegeist/ops";
import { type FormEvent, useEffect, useState } from "react";
import type { z } from "zod";
import type { QuickInsertSettings } from "../bridge";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { useI18n } from "../i18n";
import { useOpMutation } from "../lib/hooks";
import { describeError } from "../lib/utils";

type SettingsData = z.output<typeof settingsGet.output>;

function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <label className="flex items-center gap-2">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

function ErrorLine({ error }: { error: string | undefined }) {
  return error ? (
    <p role="alert" className="text-sm text-danger">
      {error}
    </p>
  ) : null;
}

/** Switch for semantic search, with the state of the model download. */
export function SemanticPanel({ data }: { data: SettingsData }) {
  const { t } = useI18n();
  const update = useOpMutation(settingsUpdate);
  const [error, setError] = useState<string>();
  const enabled = data.settings.semantic.enabled;
  const status = data.semantic;
  const percent = Math.round((status?.progress ?? 0) * 100);

  const toggle = async (next: boolean) => {
    setError(undefined);
    try {
      await update.mutateAsync({ patch: { semantic: { enabled: next } } });
    } catch (err) {
      const { message, fix } = describeError(err);
      setError(fix ? `${message} ${fix}` : message);
    }
  };

  let line: string | undefined;
  if (enabled && status) {
    if (status.state === "downloading") line = t("settings.semantic.downloading", { percent });
    else if (status.state === "ready") line = t("settings.semantic.ready");
    else if (status.state === "error") {
      line = t("settings.semantic.error", { detail: status.detail ?? "" });
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Switch
        checked={enabled}
        onChange={(next) => void toggle(next)}
        label={t("settings.semantic.switch")}
        disabled={update.isPending}
      />
      {enabled && status?.state === "downloading" ? (
        <progress
          aria-label={t("settings.semantic.progress")}
          value={percent}
          max={100}
          className="h-2 w-full max-w-sm"
        />
      ) : null}
      {line ? (
        <p
          role="status"
          className={status?.state === "error" ? "text-sm text-danger" : "text-sm text-muted"}
        >
          {line}
        </p>
      ) : null}
      <ErrorLine error={error} />
    </div>
  );
}

/** Switch and port of the Zotero Connector listener. */
export function ConnectorPanel({ data }: { data: SettingsData }) {
  const { t } = useI18n();
  const update = useOpMutation(settingsUpdate);
  const { enabled, port } = data.settings.connector;
  const [value, setValue] = useState(String(port));
  const [error, setError] = useState<string>();
  useEffect(() => setValue(String(port)), [port]);
  const status = data.connector;

  const save = async (patch: { enabled?: boolean; port?: number }) => {
    setError(undefined);
    try {
      await update.mutateAsync({ patch: { connector: patch } });
    } catch (err) {
      const { message, fix } = describeError(err);
      setError(fix ? `${message} ${fix}` : message);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next = Number(value);
    if (!Number.isInteger(next) || next < 1024 || next > 65535) {
      setError(t("settings.connector.portInvalid"));
      return;
    }
    void save({ port: next });
  };

  let line: string | undefined;
  if (enabled && status?.state === "listening") {
    line = t("settings.connector.listening", { port: status.port ?? port });
  } else if (enabled && status?.state === "error") {
    line = t("settings.connector.error", { detail: status.detail ?? "" });
  }

  return (
    <div className="flex flex-col gap-2">
      <Switch
        checked={enabled}
        onChange={(next) => void save({ enabled: next })}
        label={t("settings.connector.switch")}
        disabled={update.isPending}
      />
      <form onSubmit={submit} className="flex items-center gap-2">
        <Input
          inputMode="numeric"
          aria-label={t("settings.connector.port")}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="w-28"
        />
        <Button type="submit" disabled={update.isPending || value.trim() === String(port)}>
          {t("settings.connector.save")}
        </Button>
      </form>
      {line ? (
        <p
          role="status"
          className={status?.state === "error" ? "text-sm text-danger" : "text-sm text-muted"}
        >
          {line}
        </p>
      ) : null}
      <ErrorLine error={error} />
    </div>
  );
}

/** Hotkey of the quick-insert palette. Only shown where the app provides the palette. */
export function QuickInsertPanel() {
  const { t } = useI18n();
  const bridge = typeof window === "undefined" ? undefined : window.citegeist?.quickInsert;
  const [current, setCurrent] = useState<QuickInsertSettings>();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let alive = true;
    void bridge?.get().then((s) => {
      if (!alive) return;
      setCurrent(s);
      setValue(s.accelerator);
    });
    return () => {
      alive = false;
    };
  }, [bridge]);

  if (!bridge || !current) return null;

  const apply = async (patch: Partial<QuickInsertSettings>) => {
    setError(undefined);
    setSaved(false);
    const result = await bridge.set(patch);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    const next = await bridge.get();
    setCurrent(next);
    setValue(next.accelerator);
    setSaved(true);
  };

  return (
    <div className="flex flex-col gap-2">
      <Switch
        checked={current.enabled}
        onChange={(enabled) => void apply({ enabled })}
        label={t("settings.quickInsert.switch")}
      />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void apply({ accelerator: value });
        }}
        className="flex items-center gap-2"
      >
        <Input
          aria-label={t("settings.quickInsert.hotkey")}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setSaved(false);
          }}
          className="w-64"
        />
        <Button type="submit" disabled={value.trim() === current.accelerator}>
          {t("settings.quickInsert.save")}
        </Button>
      </form>
      {saved ? (
        <p role="status" className="text-sm text-muted">
          {t("settings.contact.saved")}
        </p>
      ) : null}
      <ErrorLine error={error} />
    </div>
  );
}
