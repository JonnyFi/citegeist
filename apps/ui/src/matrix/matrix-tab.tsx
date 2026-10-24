import {
  itemsList,
  jobsGet,
  type MatrixOp,
  matrixExport,
  matrixFill,
  matrixFillCell,
  matrixGet,
  matrixList,
  matrixUpdate,
} from "@citegeist/ops";
import { Grid3x3 } from "lucide-react";
import { useState } from "react";
import { Button, ButtonGroup } from "../components/ui/button";
import { Select } from "../components/ui/select";
import { EmptyState, ErrorState, Loading } from "../components/ui/states";
import { useI18n } from "../i18n";
import { downloadText } from "../lib/clipboard";
import { useCore, useOp, useOpMutation } from "../lib/hooks";
import { describeError } from "../lib/utils";
import { useLibraryLinks } from "../notes/library-links";
import { CreateMatrix } from "./create-matrix";
import { MatrixTable } from "./matrix-table";
import { countCells, isFilling } from "./model";

const POLL_MS = 1000;

/** Progress of one fill job: a 4px bar and the count of cells, as the job slot draws a job. */
function FillProgress({ job, cells }: { job: string; cells: number }) {
  const { t } = useI18n();
  const query = useOp(
    jobsGet,
    { job },
    {
      refetchInterval: (q) => {
        const status = q.state.data?.status;
        return status === "succeeded" || status === "failed" || status === "cancelled"
          ? false
          : POLL_MS;
      },
    },
  );
  const data = query.data;
  if (!data || data.status === "succeeded" || data.status === "cancelled") return null;
  const share = data.status === "failed" ? 0 : data.progress;
  return (
    <div className="flex items-center gap-2 text-[12px]">
      <span className="text-label font-semibold uppercase tracking-[0.1em] text-muted">
        {t("matrix.filling")}
      </span>
      <div
        role="progressbar"
        aria-label={t("matrix.filling")}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(share * 100)}
        className="h-1 w-24 bg-line-soft"
      >
        <div className="h-full bg-ink" style={{ width: `${share * 100}%` }} />
      </div>
      <span className="font-mono">
        {t("matrix.fillProgress", { done: Math.round(share * cells), total: cells })}
      </span>
    </div>
  );
}

function MatrixView({ project, id }: { project: string; id: string }) {
  const { t } = useI18n();
  const core = useCore();
  const { index } = useLibraryLinks();
  const matrix = useOp(
    matrixGet,
    { project, matrix: id },
    { refetchInterval: (q) => (isFilling(q.state.data?.matrix) ? POLL_MS : false) },
  );
  const items = useOp(itemsList, { project, inbox: false, limit: 500 });
  const update = useOpMutation(matrixUpdate);
  const fillCell = useOpMutation(matrixFillCell);
  const fill = useOpMutation(matrixFill);
  const [job, setJob] = useState<{ id: string; cells: number }>();
  const [exporting, setExporting] = useState(false);
  const [problem, setProblem] = useState<string>();

  if (matrix.isPending) return <Loading label={t("matrix.loading")} />;
  if (matrix.isError) return <ErrorState error={matrix.error} />;

  const data = matrix.data.matrix;
  const counts = countCells(data);
  const failure = (err: unknown) => setProblem(describeError(err).message);
  const busy = fill.isPending || (job !== undefined && counts.filling > 0);

  const change = (ops: MatrixOp[]) => {
    setProblem(undefined);
    update.mutate({ project, matrix: id, ops }, { onError: failure });
  };
  const startFill = (force: boolean) => {
    setProblem(undefined);
    fill.mutate(
      { project, matrix: id, force },
      {
        onSuccess: (out) => setJob({ id: out.job, cells: out.cells }),
        onError: failure,
      },
    );
  };
  const exportAs = async (format: "markdown" | "csv") => {
    setExporting(true);
    setProblem(undefined);
    try {
      const out = await core.call(matrixExport, { project, matrix: id, format });
      const name = `${project}-${data.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
      if (format === "markdown") downloadText(`${name}.md`, "text/markdown", out.text);
      else downloadText(`${name}.csv`, "text/csv", out.text);
    } catch (err) {
      failure(err);
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <div
        role="toolbar"
        aria-label={t("matrix.toolbar")}
        className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-line-soft px-8 py-2"
      >
        <span className="font-mono text-[12px] text-muted">
          {t("matrix.cellsDone", { done: counts.filled + counts.edited, total: counts.total })}
          {counts.failed > 0 ? ` · ${t("matrix.cellsFailed", { n: counts.failed })}` : ""}
        </span>
        {job ? <FillProgress key={job.id} job={job.id} cells={job.cells} /> : null}
        <span className="flex-1" />
        <ButtonGroup>
          <Button
            size="sm"
            variant="primary"
            disabled={busy || counts.total === 0 || counts.empty + counts.failed === 0}
            onClick={() => startFill(false)}
          >
            {t("matrix.fillOpen")}
          </Button>
          <Button
            size="sm"
            disabled={busy || counts.total === 0 || counts.filled === 0}
            onClick={() => startFill(true)}
          >
            {t("matrix.fillAll")}
          </Button>
        </ButtonGroup>
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-muted">{t("matrix.export")}</span>
          <ButtonGroup>
            <Button
              size="sm"
              aria-label={t("matrix.exportMdLabel")}
              disabled={exporting}
              onClick={() => void exportAs("markdown")}
            >
              {t("matrix.exportMd")}
            </Button>
            <Button
              size="sm"
              aria-label={t("matrix.exportCsvLabel")}
              disabled={exporting}
              onClick={() => void exportAs("csv")}
            >
              {t("matrix.exportCsv")}
            </Button>
          </ButtonGroup>
        </div>
      </div>
      {problem ? (
        <p role="alert" className="shrink-0 border-b border-danger px-8 py-2 text-danger">
          {problem}
        </p>
      ) : null}
      <MatrixTable
        matrix={data}
        index={index}
        candidates={items.data?.items.map((i) => i.citekey) ?? []}
        onChange={change}
        onFill={(item, column, force) => {
          setProblem(undefined);
          fillCell.mutate({ project, matrix: id, item, column, force }, { onError: failure });
        }}
      />
    </>
  );
}

export interface MatrixSearch {
  matrix?: string | undefined;
}

/** The "Matrix" tab of a project: the matrices of the project, one at a time, and the form for a new one. */
export function MatrixTab({
  project,
  matrix,
  onMatrix,
}: {
  project: string;
  matrix?: string | undefined;
  onMatrix: (id: string | undefined) => void;
}) {
  const { t } = useI18n();
  const list = useOp(matrixList, { project });
  const [creating, setCreating] = useState(false);

  if (list.isPending) return <Loading label={t("matrix.loading")} />;
  if (list.isError) return <ErrorState error={list.error} />;

  const matrices = list.data.matrices;
  if (matrices.length === 0 || creating) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {matrices.length === 0 && !creating ? (
          <EmptyState
            icon={<Grid3x3 />}
            title={t("matrix.emptyTitle")}
            description={t("matrix.emptyDescription")}
            action={
              <Button variant="primary" onClick={() => setCreating(true)}>
                {t("matrix.new")}
              </Button>
            }
          />
        ) : (
          <CreateMatrix
            project={project}
            onCancel={matrices.length > 0 ? () => setCreating(false) : undefined}
            onCreated={(id) => {
              setCreating(false);
              onMatrix(id);
            }}
          />
        )}
      </div>
    );
  }

  const current = matrices.find((m) => m.id === matrix) ?? matrices[0];
  if (!current) return null;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b border-line-soft px-8 py-2">
        {matrices.length > 1 ? (
          <Select
            label={t("matrix.switcher")}
            value={current.id}
            onChange={(id) => onMatrix(id)}
            options={matrices.map((m) => ({ value: m.id, label: m.title }))}
            className="min-w-56"
          />
        ) : (
          <h2 className="font-serif text-[18px] font-medium">{current.title}</h2>
        )}
        <span className="flex-1" />
        <Button size="sm" onClick={() => setCreating(true)}>
          {t("matrix.new")}
        </Button>
      </div>
      <MatrixView key={current.id} project={project} id={current.id} />
    </div>
  );
}
