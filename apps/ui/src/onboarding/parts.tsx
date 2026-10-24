import {
  aiTestBackend,
  jobsGet,
  type Settings,
  type settingsGet,
  workerSetup,
} from "@citegeist/ops";
import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import type { z } from "zod";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { lookup, type MessageKey, type Translator, useI18n } from "../i18n";
import { useCore } from "../lib/hooks";
import { cn, describeError } from "../lib/utils";

type SettingsData = z.output<typeof settingsGet.output>;
export type BackendInfo = SettingsData["backends"][number];
export type WorkerInfo = SettingsData["worker"];
export type MachineSettings = z.output<typeof Settings>;

/** Milliseconds between job polls. Tests lower it. */
export const pollConfig = { ms: 800 };

// Backends ------------------------------------------------------------------------------------------

/** Splits a status detail such as `ready: 2 models` into its stable code and the rest. */
export function splitDetail(detail: string | undefined): { code: string; rest: string } {
  const at = detail?.indexOf(":") ?? -1;
  if (!detail) return { code: "", rest: "" };
  return at < 0
    ? { code: detail, rest: "" }
    : { code: detail.slice(0, at), rest: detail.slice(at + 1).trim() };
}

export function statusText(tr: Translator, backend: BackendInfo): string {
  const { t } = tr;
  const { code, rest } = splitDetail(backend.detail);
  const base =
    lookup(tr, `backend.status.${code}`) ??
    (backend.available ? t("backend.status.ready") : t("backend.status.unknown"));
  const models = /^(\d+) models$/.exec(rest);
  return code === "ready" && models
    ? `${base} (${t("backend.models", { n: models[1] ?? "0" })})`
    : base;
}

export type TestState =
  | { status: "running" }
  | { status: "ok"; latencyMs: number }
  | { status: "failed"; message: string; fix?: string };

/** Runs `ai.testBackend` per backend id and keeps the latest result of each. */
export function useBackendTests() {
  const core = useCore();
  const [tests, setTests] = useState<Record<string, TestState>>({});
  const run = useCallback(
    async (id: string) => {
      setTests((prev) => ({ ...prev, [id]: { status: "running" } }));
      let next: TestState;
      try {
        const r = await core.call(aiTestBackend, { backend: id });
        next = r.ok
          ? { status: "ok", latencyMs: r.latencyMs ?? 0 }
          : {
              status: "failed",
              message: r.error?.message ?? "",
              ...(r.error?.fix ? { fix: r.error.fix } : {}),
            };
      } catch (err) {
        const { message, fix } = describeError(err);
        next = { status: "failed", message, ...(fix ? { fix } : {}) };
      }
      setTests((prev) => ({ ...prev, [id]: next }));
      return next;
    },
    [core],
  );
  return { tests, run };
}

export function BackendRow({
  backend,
  test,
  onTest,
  selected,
  onSelect,
  keyStored,
  onSaveKey,
  onRemoveKey,
}: {
  backend: BackendInfo;
  test: TestState | undefined;
  onTest: () => void;
  selected?: boolean;
  onSelect?: () => void;
  /** Set for API-key backends in the settings screen. */
  keyStored?: boolean;
  onSaveKey?: (key: string) => Promise<unknown>;
  onRemoveKey?: () => Promise<unknown>;
}) {
  const tr = useI18n();
  const { t } = tr;
  const { code } = splitDetail(backend.detail);
  // the translated hint names the install and login commands; an error from the core stands in
  // for backends without a translation
  const hint = lookup(tr, `backend.hint.${backend.id}.${code}`) ?? backend.error?.fix;
  const [key, setKey] = useState("");
  const [saving, setSaving] = useState(false);

  const saveKey = async (e: FormEvent) => {
    e.preventDefault();
    if (!onSaveKey || !key.trim()) return;
    setSaving(true);
    try {
      await onSaveKey(key.trim());
      setKey("");
    } finally {
      setSaving(false);
    }
  };

  return (
    <li
      data-testid="backend"
      data-backend={backend.id}
      className="border border-line bg-surface p-3"
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium">{backend.label}</span>
            <Badge tone="outline">{t(`backend.kind.${backend.kind}` as MessageKey)}</Badge>
          </div>
          <p className="flex items-center gap-1.5 text-sm text-muted">
            <span
              aria-hidden="true"
              className={cn("size-1.5", backend.available ? "bg-accent" : "bg-danger")}
            />
            {statusText(tr, backend)}
          </p>
          {hint && !backend.available ? <p className="mt-1 text-sm">{hint}</p> : null}
        </div>
        <div className="flex shrink-0 gap-2">
          {onSelect ? (
            <Button
              variant={selected ? "primary" : "outline"}
              aria-pressed={selected ?? false}
              onClick={onSelect}
              disabled={!backend.available}
            >
              {selected ? t("onb.backend.inUse") : t("onb.backend.use")}
            </Button>
          ) : null}
          <Button onClick={onTest} disabled={test?.status === "running"}>
            {test?.status === "running" ? t("backend.testing") : t("backend.test")}
          </Button>
        </div>
      </div>
      {test && test.status !== "running" ? (
        <p
          role="status"
          className={cn("mt-2 text-sm", test.status === "failed" ? "text-danger" : "text-muted")}
        >
          {test.status === "ok"
            ? t("backend.testOk", { seconds: (test.latencyMs / 1000).toFixed(1) })
            : test.message}
          {test.status === "failed" && test.fix ? (
            <span className="mt-0.5 block text-muted">{test.fix}</span>
          ) : null}
        </p>
      ) : null}
      {onSaveKey && backend.kind === "api-key" ? (
        keyStored ? (
          <div className="mt-2 flex items-center gap-3 text-sm text-muted">
            {t("backend.key.stored")}
            <Button size="sm" variant="ghost" onClick={() => void onRemoveKey?.()}>
              {t("backend.key.remove")}
            </Button>
          </div>
        ) : (
          <form onSubmit={(e) => void saveKey(e)} className="mt-2 flex gap-2">
            <Input
              type="password"
              autoComplete="off"
              aria-label={`${backend.label}: ${t("backend.key.label")}`}
              placeholder={t("backend.key.label")}
              value={key}
              onChange={(e) => setKey(e.target.value)}
            />
            <Button type="submit" disabled={!key.trim() || saving}>
              {t("backend.key.save")}
            </Button>
          </form>
        )
      ) : null}
    </li>
  );
}

// Worker --------------------------------------------------------------------------------------------

export interface SetupState {
  phase: "idle" | "running" | "failed" | "done";
  progress: number;
  message?: string;
  errorCode?: string;
  errorMessage?: string;
}

/** Starts `worker.setup` and follows its job until it ends. Refreshes the settings afterwards. */
export function useWorkerSetup() {
  const core = useCore();
  const queryClient = useQueryClient();
  const [state, setState] = useState<SetupState>({ phase: "idle", progress: 0 });
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const start = useCallback(
    async (force: boolean) => {
      setState({ phase: "running", progress: 0 });
      try {
        const { job } = await core.call(workerSetup, { force });
        for (;;) {
          const status = await core.call(jobsGet, { job });
          if (!alive.current) return;
          if (status.status === "succeeded") {
            setState({ phase: "done", progress: 1 });
            break;
          }
          if (status.status === "failed" || status.status === "cancelled") {
            setState({
              phase: "failed",
              progress: status.progress,
              errorCode: status.error?.code ?? "",
              errorMessage: status.error?.message ?? "",
            });
            break;
          }
          setState({
            phase: "running",
            progress: status.progress,
            ...(status.message ? { message: status.message } : {}),
          });
          await new Promise((r) => setTimeout(r, pollConfig.ms));
        }
      } catch (err) {
        if (!alive.current) return;
        setState({
          phase: "failed",
          progress: 0,
          errorCode: "",
          errorMessage: describeError(err).message,
        });
      }
      await queryClient.invalidateQueries({ queryKey: ["op"] });
    },
    [core, queryClient],
  );
  return { state, start };
}

export function WorkerPanel({ worker }: { worker: WorkerInfo }) {
  const tr = useI18n();
  const { t } = tr;
  const queryClient = useQueryClient();
  const { state, start } = useWorkerSetup();
  const running = state.phase === "running" || (worker.detail === "installing" && !worker.ready);

  // A setup started before a reload still runs in the core; follow it by refetching the status.
  useEffect(() => {
    if (state.phase !== "idle" || worker.detail !== "installing") return;
    const timer = setTimeout(
      () => void queryClient.invalidateQueries({ queryKey: ["op"] }),
      pollConfig.ms * 2,
    );
    return () => clearTimeout(timer);
  }, [state.phase, worker.detail, queryClient]);

  const { code } = splitDetail(worker.detail);
  const label = worker.ready
    ? t("worker.status.ready")
    : (lookup(tr, `worker.status.${code}`) ?? t("worker.status.not-ready"));
  const engines = Object.entries(worker.engines)
    .map(([name, version]) => `${name} ${version}`)
    .join(", ");
  const progressMessage = state.message
    ? (lookup(tr, `worker.progress.${state.message}`) ?? state.message)
    : undefined;
  const errorText =
    state.phase === "failed"
      ? (lookup(tr, `worker.error.${state.errorCode}`) ??
        (state.errorMessage || t("worker.failed")))
      : undefined;

  return (
    <div data-testid="worker-panel" className="border border-line bg-surface p-3">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-sm">
            <span
              aria-hidden="true"
              className={cn("size-1.5", worker.ready ? "bg-accent" : "bg-danger")}
            />
            <span data-testid="worker-status">
              {running ? t("worker.status.installing") : label}
            </span>
          </p>
          {worker.ready && engines ? (
            <p className="text-sm text-muted">{t("worker.engines", { engines })}</p>
          ) : null}
        </div>
        <Button
          variant={worker.ready ? "outline" : "primary"}
          disabled={running}
          onClick={() => void start(worker.ready)}
        >
          {worker.ready ? t("worker.reinstall") : t("worker.install")}
        </Button>
      </div>
      {state.phase === "running" ? (
        <div className="mt-3">
          <div
            role="progressbar"
            aria-label={t("worker.status.installing")}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(state.progress * 100)}
            className="h-1.5 overflow-hidden bg-sunken"
          >
            <div
              className="h-full bg-accent transition-all"
              style={{ width: `${Math.round(state.progress * 100)}%` }}
            />
          </div>
          {progressMessage ? <p className="mt-1 text-sm text-muted">{progressMessage}</p> : null}
        </div>
      ) : null}
      {errorText ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {errorText}
        </p>
      ) : null}
    </div>
  );
}
