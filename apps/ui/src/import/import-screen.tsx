import {
  DEFAULT_ZOTERO_PORT,
  ImportResult,
  importPreview,
  importRun,
  jobsGet,
} from "@citegeist/ops";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { type DragEvent, useEffect, useId, useRef, useState } from "react";
import type { z } from "zod";
import type { PickPathsOptions } from "../bridge";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Segmented } from "../components/ui/segmented";
import { type MessageKey, useI18n } from "../i18n";
import { useCore } from "../lib/hooks";
import { pollConfig } from "../onboarding/parts";
import { Bar, ErrorLine, errorText, FieldLabel, Section } from "../settings/parts";
import { ReportView, ResultView } from "./report-view";

type PreviewInput = z.input<typeof importPreview.input>;
type Report = z.output<typeof importPreview.output>;
type Result = z.output<typeof ImportResult>;

export type SourceKind = "zotero-sqlite" | "zotero-api" | "bibtex" | "ris" | "csl-json";
const KINDS: readonly SourceKind[] = ["zotero-sqlite", "zotero-api", "bibtex", "ris", "csl-json"];
type Collections = "projects" | "tags" | "none";
type Duplicates = "skip" | "merge";

interface Form {
  kind: SourceKind;
  path: string;
  storage: string;
  pdfFolder: string;
  port: string;
  collections: Collections;
  onDuplicate: Duplicates;
  attachments: boolean;
  notes: boolean;
  annotations: boolean;
  automaticTags: boolean;
}

const INITIAL: Form = {
  kind: "zotero-sqlite",
  path: "",
  storage: "",
  pdfFolder: "",
  port: String(DEFAULT_ZOTERO_PORT),
  collections: "tags",
  onDuplicate: "skip",
  attachments: true,
  notes: true,
  annotations: true,
  automaticTags: true,
};

const FILE_EXTENSIONS: Partial<Record<SourceKind, readonly string[]>> = {
  bibtex: ["bib", "bibtex"],
  ris: ["ris"],
  "csl-json": ["json"],
};

const isZotero = (kind: SourceKind) => kind === "zotero-sqlite" || kind === "zotero-api";

/** The input of import.preview and import.run for the form, or undefined while it is incomplete. */
export function buildInput(form: Form): PreviewInput | undefined {
  const { kind } = form;
  const options = {
    onDuplicate: form.onDuplicate,
    attachments: form.attachments,
    ...(isZotero(kind)
      ? {
          collections: form.collections,
          notes: form.notes,
          annotations: form.annotations && form.attachments,
          automaticTags: form.automaticTags,
        }
      : {}),
  };
  if (kind === "zotero-api") {
    const port = Number(form.port);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) return undefined;
    return { ...options, source: { kind, port } };
  }
  const path = form.path.trim();
  if (!path) return undefined;
  if (kind === "zotero-sqlite") {
    const storage = form.storage.trim();
    return { ...options, source: { kind, path, ...(storage ? { storage } : {}) } };
  }
  const pdfFolder = form.pdfFolder.trim();
  return { ...options, source: { kind, path, ...(pdfFolder ? { pdfFolder } : {}) } };
}

/** Text field for a path. A file or folder dropped onto it fills in its path where the app can read it. */
function PathField({
  label,
  value,
  onChange,
  pick,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** What the native picker offers; without it, or in the browser preview, the path is typed. */
  pick: PickPathsOptions;
}) {
  const { t } = useI18n();
  const id = useId();
  const drop = (e: DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    const path = file ? window.citegeist?.pathForFile?.(file) : undefined;
    if (path) onChange(path);
  };
  return (
    <div className="flex flex-col gap-1">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <div className="flex gap-2">
        <Input
          id={id}
          value={value}
          placeholder={t("import.path.placeholder")}
          onChange={(e) => onChange(e.target.value)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={drop}
          className="min-w-0 flex-1 font-mono"
        />
        {window.citegeist?.pickPaths ? (
          <Button
            aria-label={`${t("import.pick")}: ${label}`}
            onClick={() => {
              void window.citegeist?.pickPaths?.({ ...pick, title: label }).then((paths) => {
                if (paths[0]) onChange(paths[0]);
              });
            }}
          >
            {t("import.pick")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function Check({
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
      <span className={disabled ? "text-muted" : undefined}>{label}</span>
    </label>
  );
}

type Run =
  | { phase: "idle" }
  | { phase: "running"; progress: number; message?: string }
  | { phase: "failed"; message: string }
  | { phase: "done"; result: Result | undefined };

/** Import screen: choose the source and options, check the dry run, run the job. */
export function ImportScreen() {
  const { t } = useI18n();
  const core = useCore();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<Form>(INITIAL);
  const [preview, setPreview] = useState<{ key: string; report: Report }>();
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState<string>();
  const [run, setRun] = useState<Run>({ phase: "idle" });
  const portId = useId();
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const set = <K extends keyof Form>(key: K, value: Form[K]) =>
    setForm((f) => ({ ...f, [key]: value }));
  const input = buildInput(form);
  const key = input ? JSON.stringify(input) : "";
  const current = preview?.key === key ? preview.report : undefined;
  const busy = previewing || run.phase === "running";
  const zotero = isZotero(form.kind);
  const portBad = form.kind === "zotero-api" && input === undefined;

  const doPreview = async () => {
    if (!input) return;
    setError(undefined);
    setPreview(undefined);
    setRun({ phase: "idle" });
    setPreviewing(true);
    try {
      const report = await core.call(importPreview, input);
      if (alive.current) setPreview({ key, report });
    } catch (err) {
      if (alive.current) setError(errorText(err));
    } finally {
      if (alive.current) setPreviewing(false);
    }
  };

  const doRun = async () => {
    if (!input || !current) return;
    setError(undefined);
    setRun({ phase: "running", progress: 0 });
    try {
      const { job } = await core.call(importRun, input);
      for (;;) {
        const status = await core.call(jobsGet, { job });
        if (!alive.current) return;
        if (status.status === "succeeded") {
          const parsed = ImportResult.safeParse(status.result);
          setRun({ phase: "done", result: parsed.success ? parsed.data : undefined });
          break;
        }
        if (status.status === "failed" || status.status === "cancelled") {
          setRun({
            phase: "failed",
            message: status.error?.message ?? t("import.failed"),
          });
          break;
        }
        setRun({
          phase: "running",
          progress: status.progress,
          ...(status.message ? { message: status.message } : {}),
        });
        await new Promise((r) => setTimeout(r, pollConfig.ms));
      }
    } catch (err) {
      if (alive.current) setRun({ phase: "failed", message: errorText(err) });
    }
    await queryClient.invalidateQueries({ queryKey: ["op"] });
  };

  const done = run.phase === "done";

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-8">
      <div>
        <h1 className="font-serif text-2xl font-semibold">{t("import.title")}</h1>
        <p className="text-muted">{t("import.desc")}</p>
      </div>

      <Section id="import-source" title={t("import.source")}>
        <Segmented<SourceKind>
          label={t("import.source")}
          value={form.kind}
          options={KINDS.map((value) => ({
            value,
            label: t(`import.kind.${value}` as MessageKey),
          }))}
          onChange={(kind) => set("kind", kind)}
          className="flex-wrap"
        />
        <p className="text-sm text-muted">
          {t(zotero ? (`import.hint.${form.kind}` as MessageKey) : "import.hint.file")}
        </p>
        {form.kind === "zotero-sqlite" ? (
          <>
            <PathField
              label={t("import.path.sqlite")}
              value={form.path}
              onChange={(v) => set("path", v)}
              pick={{ kind: "any" }}
            />
            <PathField
              label={t("import.path.storage")}
              value={form.storage}
              onChange={(v) => set("storage", v)}
              pick={{ kind: "folder" }}
            />
          </>
        ) : form.kind === "zotero-api" ? (
          <div className="flex flex-col gap-1">
            <FieldLabel htmlFor={portId}>{t("import.port")}</FieldLabel>
            <Input
              id={portId}
              inputMode="numeric"
              value={form.port}
              onChange={(e) => set("port", e.target.value)}
              className="w-28"
            />
            {portBad ? <p className="text-sm text-danger">{t("import.portInvalid")}</p> : null}
          </div>
        ) : (
          <>
            <PathField
              label={t("import.path.file")}
              value={form.path}
              onChange={(v) => set("path", v)}
              pick={{ kind: "file", extensions: FILE_EXTENSIONS[form.kind] ?? [] }}
            />
            <PathField
              label={t("import.path.pdfFolder")}
              value={form.pdfFolder}
              onChange={(v) => set("pdfFolder", v)}
              pick={{ kind: "folder" }}
            />
          </>
        )}
      </Section>

      <Section id="import-options" title={t("import.options")}>
        {zotero ? (
          <div className="flex items-center justify-between gap-4">
            <span>{t("import.collections")}</span>
            <Segmented<Collections>
              label={t("import.collections")}
              value={form.collections}
              options={(["projects", "tags", "none"] as const).map((value) => ({
                value,
                label: t(`import.collections.${value}` as MessageKey),
              }))}
              onChange={(v) => set("collections", v)}
            />
          </div>
        ) : null}
        <div className="flex items-center justify-between gap-4">
          <span>{t("import.duplicates")}</span>
          <Segmented<Duplicates>
            label={t("import.duplicates")}
            value={form.onDuplicate}
            options={(["skip", "merge"] as const).map((value) => ({
              value,
              label: t(`import.duplicates.${value}` as MessageKey),
            }))}
            onChange={(v) => set("onDuplicate", v)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Check
            checked={form.attachments}
            onChange={(v) => set("attachments", v)}
            label={t("import.attachments")}
          />
          {zotero ? (
            <>
              <Check
                checked={form.notes}
                onChange={(v) => set("notes", v)}
                label={t("import.notes")}
              />
              <Check
                checked={form.annotations && form.attachments}
                disabled={!form.attachments}
                onChange={(v) => set("annotations", v)}
                label={t("import.annotations")}
              />
              <Check
                checked={form.automaticTags}
                onChange={(v) => set("automaticTags", v)}
                label={t("import.automaticTags")}
              />
            </>
          ) : null}
        </div>
      </Section>

      <div className="flex flex-col gap-2 border-t border-line pt-6">
        <div className="flex items-center gap-2">
          <Button disabled={!input || busy} onClick={() => void doPreview()}>
            {previewing ? t("import.previewing") : t("import.preview")}
          </Button>
          <Button
            variant="primary"
            disabled={!current || busy || done}
            onClick={() => void doRun()}
          >
            {t("import.run")}
          </Button>
        </div>
        {!current && !busy && !done && input ? (
          <p className="text-sm text-muted">{t("import.run.needPreview")}</p>
        ) : null}
        <ErrorLine error={error} />
      </div>

      {run.phase === "running" ? (
        <div className="flex flex-col gap-1" data-testid="import-progress">
          <p>{t("import.progress")}</p>
          <Bar value={run.progress} label={t("import.progress")} />
          {run.message ? <p className="text-sm text-muted">{run.message}</p> : null}
        </div>
      ) : null}
      {run.phase === "failed" ? (
        <div role="alert" className="border border-danger px-4 py-3">
          <p className="font-medium text-danger">{t("import.failed")}</p>
          <p className="text-muted">{run.message}</p>
        </div>
      ) : null}
      {done ? (
        <Section id="import-done" title={t("import.done.title")}>
          {run.result ? <ResultView result={run.result} /> : null}
          <div className="flex gap-2">
            <Link
              to="/"
              search={{}}
              className="inline-flex h-7 items-center border border-ink bg-ink px-3 text-[12px] font-medium text-bg"
            >
              {t("import.result.open")}
            </Link>
            <Button
              onClick={() => {
                setRun({ phase: "idle" });
                setPreview(undefined);
              }}
            >
              {t("import.result.again")}
            </Button>
          </div>
        </Section>
      ) : current ? (
        <ReportView report={current} />
      ) : null}
    </div>
  );
}
