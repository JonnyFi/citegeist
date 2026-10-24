import {
  jobsGet,
  pandocSetup,
  pandocStatus,
  type TextExportFormat,
  textsExport,
} from "@citegeist/ops";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { z } from "zod";
import { Button, ButtonGroup } from "../components/ui/button";
import { type MessageKey, useI18n } from "../i18n";
import { useCore, useOp } from "../lib/hooks";
import { describeError } from "../lib/utils";

const FORMATS: readonly TextExportFormat[] = ["docx", "latex", "pdf", "md"];

type Exported = z.output<typeof textsExport.output>;

/** Pandoc missing: the way to get it, either the pinned download or the Homebrew command. */
export function PandocBanner() {
  const { t } = useI18n();
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
          {t("texts.pandoc.failed")}{" "}
          {failure !== null ? describeError(failure).message : (watch.data?.error?.message ?? "")}
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
  const { t } = useI18n();
  const core = useCore();
  const [busy, setBusy] = useState<TextExportFormat | null>(null);
  const [result, setResult] = useState<Exported | null>(null);
  const [failure, setFailure] = useState<unknown>(null);

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

  const failed = failure === null ? undefined : describeError(failure);
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <span className="text-[12px] text-muted">{t("texts.export.label")}</span>
        <ButtonGroup>
          {FORMATS.map((format) => (
            <Button
              key={format}
              size="sm"
              disabled={busy !== null}
              title={t(`texts.export.${format}.hint` as MessageKey)}
              onClick={() => void run(format)}
            >
              {t(`texts.export.${format}` as MessageKey)}
            </Button>
          ))}
        </ButtonGroup>
      </div>
      <div aria-live="polite" className="max-w-[560px] text-right text-[12px]">
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
