import type { MatrixOp } from "@citegeist/ops";
import type { Matrix, MatrixColumn } from "@citegeist/schema";
import { Link } from "@tanstack/react-router";
import { Pencil, Plus, X } from "lucide-react";
import { useState } from "react";
import { Button } from "../components/ui/button";
import { Input, Textarea } from "../components/ui/input";
import { Select } from "../components/ui/select";
import { useI18n } from "../i18n";
import type { LinkIndex } from "../notes/library-links";
import { RetractionBadge, useRetractionMarkers } from "../related";
import { MatrixCellView } from "./cell";
import { cellOf, rowLabel } from "./model";

const TH = "border-b border-line px-3 py-2 text-left align-top font-normal";
const TD = "border-b border-line-soft px-3 py-3 align-top";

/** Name and instruction of a column, for a new one or for changing an existing one. */
function ColumnEditor({
  column,
  onSave,
  onRemove,
  onCancel,
}: {
  column?: MatrixColumn;
  onSave: (name: string, instruction: string) => void;
  onRemove?: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(column?.name ?? "");
  const [instruction, setInstruction] = useState(column?.instruction ?? "");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) onSave(name.trim(), instruction.trim());
      }}
      className="flex flex-col gap-2"
    >
      <Input
        autoFocus
        aria-label={t("matrix.col.name")}
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <Textarea
        aria-label={t("matrix.col.instruction")}
        rows={3}
        value={instruction}
        onChange={(e) => setInstruction(e.target.value)}
        className="text-[12px]"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" variant="primary" disabled={!name.trim()}>
          {t("matrix.col.save")}
        </Button>
        <Button type="button" size="sm" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        {onRemove ? (
          <Button type="button" size="sm" onClick={onRemove}>
            {t("matrix.col.remove")}
          </Button>
        ) : null}
      </div>
    </form>
  );
}

function ColumnHead({
  column,
  onChange,
}: {
  column: MatrixColumn;
  onChange: (ops: MatrixOp[]) => void;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  return (
    <th scope="col" className={`${TH} w-[300px] min-w-[300px]`}>
      {editing ? (
        <ColumnEditor
          column={column}
          onCancel={() => setEditing(false)}
          onSave={(name, instruction) => {
            onChange([{ op: "updateColumn", column: column.id, name, instruction }]);
            setEditing(false);
          }}
          onRemove={() => {
            onChange([{ op: "removeColumn", column: column.id }]);
            setEditing(false);
          }}
        />
      ) : (
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-[13px] font-semibold">{column.name}</span>
            {column.instruction ? (
              <span className="line-clamp-2 text-[11px] font-normal text-muted">
                {column.instruction}
              </span>
            ) : null}
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="size-6 shrink-0"
            aria-label={t("matrix.col.edit", { name: column.name })}
            onClick={() => setEditing(true)}
          >
            <Pencil className="size-3.5" />
          </Button>
        </div>
      )}
    </th>
  );
}

function AddColumn({ onChange }: { onChange: (ops: MatrixOp[]) => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <th scope="col" className={`${TH} w-[300px] min-w-[300px]`}>
      {open ? (
        <ColumnEditor
          onCancel={() => setOpen(false)}
          onSave={(name, instruction) => {
            onChange([{ op: "addColumn", name, instruction }]);
            setOpen(false);
          }}
        />
      ) : (
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus className="size-3.5" />
          {t("matrix.col.add")}
        </Button>
      )}
    </th>
  );
}

/**
 * The matrix as a table: sources in rows, questions in columns. The source column stays in view
 * while the columns scroll sideways.
 */
export function MatrixTable({
  matrix,
  index,
  candidates,
  onChange,
  onFill,
}: {
  matrix: Matrix;
  index: LinkIndex | undefined;
  /** Citekeys the project offers as new rows. */
  candidates: readonly string[];
  onChange: (ops: MatrixOp[]) => void;
  onFill: (item: string, column: string, force: boolean) => void;
}) {
  const { t } = useI18n();
  const markers = useRetractionMarkers(matrix.rows);
  const open = candidates.filter((k) => !matrix.rows.includes(k));
  const addOptions = [
    { value: "", label: t("matrix.row.add") },
    ...open.map((k) => {
      const item = index?.items.get(k);
      return { value: k, label: [rowLabel(item), item?.title ?? k].filter(Boolean).join(", ") };
    }),
  ];

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <table aria-label={t("matrix.table")} className="border-collapse text-[13px]">
        <thead>
          <tr>
            <th
              scope="col"
              className={`${TH} sticky left-0 z-10 w-[220px] min-w-[220px] bg-bg pl-8 text-label font-semibold uppercase tracking-[0.1em] text-muted`}
            >
              {t("matrix.col.source")}
            </th>
            {matrix.columns.map((column) => (
              <ColumnHead key={column.id} column={column} onChange={onChange} />
            ))}
            <AddColumn onChange={onChange} />
          </tr>
        </thead>
        <tbody>
          {matrix.rows.map((citekey) => {
            const item = index?.items.get(citekey);
            const title = item?.title ?? citekey;
            const label = rowLabel(item) || citekey;
            const marker = markers.get(citekey);
            return (
              <tr key={citekey} data-testid="matrix-row" data-citekey={citekey}>
                <th
                  scope="row"
                  className={`${TD} sticky left-0 z-10 bg-bg pl-8 text-left font-normal`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 flex-col gap-1">
                      <span className="font-mono text-[11px] text-muted">{label}</span>
                      <Link
                        to="/items/$citekey"
                        params={{ citekey }}
                        className="line-clamp-3 font-medium hover:underline"
                      >
                        {title}
                      </Link>
                      {marker ? (
                        <span>
                          <RetractionBadge marker={marker} />
                        </span>
                      ) : null}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6 shrink-0"
                      aria-label={t("matrix.row.remove", { title })}
                      onClick={() => onChange([{ op: "removeRow", item: citekey }])}
                    >
                      <X className="size-3.5" />
                    </Button>
                  </div>
                </th>
                {matrix.columns.map((column) => {
                  const cell = cellOf(matrix, citekey, column.id);
                  return (
                    <td
                      key={column.id}
                      data-testid="matrix-cell"
                      data-status={cell.status}
                      data-column={column.name}
                      className={TD}
                    >
                      <MatrixCellView
                        citekey={citekey}
                        itemLabel={label}
                        column={column}
                        cell={cell}
                        onFill={(force) => onFill(citekey, column.id, force)}
                        onSet={(answer) =>
                          onChange([{ op: "setCell", item: citekey, column: column.id, answer }])
                        }
                        onClear={() =>
                          onChange([{ op: "clearCell", item: citekey, column: column.id }])
                        }
                      />
                    </td>
                  );
                })}
                <td className={TD} />
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="flex items-center gap-3 px-8 py-3">
        {matrix.rows.length === 0 ? (
          <span className="text-muted">{t("matrix.rowsEmpty")}</span>
        ) : null}
        {open.length > 0 ? (
          <Select
            label={t("matrix.row.add")}
            value=""
            onChange={(citekey) => {
              if (citekey) onChange([{ op: "addRow", item: citekey }]);
            }}
            options={addOptions}
            className="min-w-56"
          />
        ) : null}
      </div>
    </div>
  );
}
