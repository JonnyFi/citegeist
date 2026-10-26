import {
  jobsGet,
  pandocSetup,
  pandocStatus,
  type TextExportFormat,
  textsExport,
  typstSetup,
  typstStatus,
} from "@citegeist/ops";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { z } from "zod";
import { Button, ButtonGroup } from "../components/ui/button";
import { type MessageKey, useI18n } from "../i18n";
import { useCore, useOp } from "../lib/hooks";
import { describeError } from "../lib/utils";
import { localizedError } from "./errors";

const POLL_MS = 600;

const FORMATS: readonly TextExportFormat[] = ["docx", "latex", "pdf", "md"];

type Exported = z.output<typeof textsExport.output>;

/** Pandoc missing: the way to get it, either the pinned download or the Homebrew command. */
export function PandocBanner() {
  const i18n = useI18n();
  const { t } = i18n;
  const core = useCore();
  const queryClient = useQueryClient();
  const status = useOp(pandocStatus, {});
  const [job, setJob] = useState<string | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  const watch = useOp(
    jobsGet,
    { job: job ?? "j_0000000000" },
    {
      enabled: job !== null,
      refetchInterval: (q) =>
        q.state.data?.status === "running" || q.state.data?.status === "queued" ? 800 : false,
    },
  );

  const state = watch.data?.status;
  useEffect(() => {
    if (state === "succeeded") void queryClient.invalidateQueries({ queryKey: ["op"] });
  }, [state, queryClient]);

  if (!status.data || status.data.found) return null;
  const installing =
    job !== null && (state === undefined || state === "running" || state === "queued");
  const failed = state === "failed" || failure !== null;
  const shown = localizedError(
    i18n,
    failure !== null ? describeError(failure) : (watch.data?.error ?? { message: "" }),
  );
  const failureText = [shown.message, shown.fix].filter(Boolean).join(" ");

  const install = async () => {
    setFailure(null);
    try {
      const started = await core.call(pandocSetup, {});
      setJob(started.job);
    } catch (err) {
      setFailure(err);
    }
  };

  return (
    <div
      role="status"
      className="mb-3 flex flex-wrap items-center gap-3 border border-line px-3 py-2"
    >
      <span>{t("texts.pandoc.missing")}</span>
      {status.data.installable ? (
        <Button size="sm" disabled={installing} onClick={() => void install()}>
          {installing ? t("texts.pandoc.installing") : t("texts.pandoc.install")}
        </Button>
      ) : null}
      <span className="text-muted">{t("texts.pandoc.manual")}</span>
      {failed ? (
        <span role="alert" className="text-danger">
          {t("texts.pandoc.failed")} {failureText}
        </span>
      ) : null}
    </div>
  );
}

/** The export buttons of a text and what the last export produced. */
export function ExportBar({
  project,
  text,
  beforeExport,
}: {
  project: string;
  text: string;
  /** Saves pending edits, so the export holds what is on screen. */
  beforeExport: () => Promise<void>;
}) {
  const i18n = useI18n();
  const { t } = i18n;
  const core = useCore();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<TextExportFormat | null>(null);
  const [result, setResult] = useState<Exported | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  // "ask": PDF was chosen and Typst is missing. "loading": the download runs.
  const [typst, setTypst] = useState<{ phase: "idle" | "ask" | "loading"; sizeMb: number }>({
    phase: "idle",
    sizeMb: 0,
  });
  const [progress, setProgress] = useState(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = async (format: TextExportFormat) => {
    setBusy(format);
    setFailure(null);
    setResult(null);
    try {
      await beforeExport();
      setResult(await core.call(textsExport, { project, text, format }));
    } catch (err) {
      setFailure(err);
    } finally {
      setBusy(null);
    }
  };

  /** PDF needs Typst: ask before the download starts, otherwise export right away. */
  const choose = async (format: TextExportFormat) => {
    setTypst({ phase: "idle", sizeMb: 0 });
    if (format === "pdf") {
      try {
        const status = await core.call(typstStatus, {});
        if (!status.found && status.installable) {
          setFailure(null);
          setResult(null);
          setTypst({ phase: "ask", sizeMb: status.sizeMb });
          return;
        }
      } catch (err) {
        setFailure(err);
        return;
      }
    }
    await run(format);
  };

  const install = async () => {
    setFailure(null);
    setProgress(0);
    setTypst((prev) => ({ ...prev, phase: "loading" }));
    try {
      const started = await core.call(typstSetup, {});
      for (;;) {
        const job = await core.call(jobsGet, { job: started.job });
        if (!mounted.current) return;
        setProgress(job.progress);
        if (job.status === "succeeded") break;
        if (job.status === "failed" || job.status === "cancelled") {
          throw job.error ? { data: job.error } : new Error(t("texts.typst.failed"));
        }
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      }
      void queryClient.invalidateQueries({ queryKey: ["op"] });
      setTypst({ phase: "idle", sizeMb: 0 });
      await run("pdf");
    } catch (err) {
      if (!mounted.current) return;
      setTypst({ phase: "idle", sizeMb: 0 });
      setFailure(err);
    }
  };

  const failed = failure === null ? undefined : localizedError(i18n, describeError(failure));
  const loading = typst.phase === "loading";
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <span className="text-[12px] text-muted">{t("texts.export.label")}</span>
        <ButtonGroup>
          {FORMATS.map((format) => (
            <Button
              key={format}
              size="sm"
              disabled={busy !== null || loading}
              title={t(`texts.export.${format}.hint` as MessageKey)}
              onClick={() => void choose(format)}
            >
              {t(`texts.export.${format}` as MessageKey)}
            </Button>
          ))}
        </ButtonGroup>
      </div>
      <div aria-live="polite" className="max-w-[560px] text-right text-[12px]">
        {typst.phase === "ask" ? (
          <div data-testid="typst-ask" className="flex flex-wrap items-center justify-end gap-2">
            <span>{t("texts.typst.ask", { size: typst.sizeMb })}</span>
            <Button size="sm" variant="primary" onClick={() => void install()}>
              {t("texts.typst.load")}
            </Button>
            <Button size="sm" onClick={() => setTypst({ phase: "idle", sizeMb: 0 })}>
              {t("texts.typst.cancel")}
            </Button>
          </div>
        ) : null}
        {loading ? (
          <div data-testid="typst-progress" className="flex items-center justify-end gap-2">
            <span className="text-muted">
              {t("texts.typst.loading", { percent: Math.round(progress * 100) })}
            </span>
            <progress
              className="h-1 w-24"
              max={1}
              value={progress}
              aria-label={t("job.kind.typst-setup")}
            />
          </div>
        ) : null}
        {busy ? <span className="text-muted">{t("texts.export.running")}</span> : null}
        {result ? (
          <div data-testid="export-result">
            <p>{t("texts.export.done", { path: result.absolutePath })}</p>
            {result.unknown.length > 0 ? (
              <p className="text-danger">
                {t("texts.export.unknown", { keys: result.unknown.join(", ") })}
              </p>
            ) : null}
            {result.warnings.length > 0 ? (
              <p className="text-muted">
                {t("texts.export.warnings", { warnings: result.warnings.join(" ") })}
              </p>
            ) : null}
          </div>
        ) : null}
        {failed ? (
          <div role="alert" className="text-danger">
            <p>{failed.message}</p>
            {failed.fix ? <p className="text-muted">{failed.fix}</p> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
