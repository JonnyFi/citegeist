import { GripVertical } from "lucide-react";
import { type DragEvent, type KeyboardEvent, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { type DropPlace, dropPlace, dropPosition } from "../lib/reading-order";

/** What the table needs to show and change the reading order of a project. */
export interface ReadingControl {
  /** The note on each item, by citekey. */
  notes: ReadonlyMap<string, string>;
  /** Moves an item to a position (0 is first). `keepFocus` puts the focus back on its handle. */
  onMove: (citekey: string, position: number, opts?: { keepFocus?: boolean }) => void;
  onNote: (citekey: string, note: string) => void;
}

/**
 * Drag and drop of rows by their handle. The rows take the drop: the upper half of a row puts the
 * dragged item before it, the lower half after it.
 */
export function useRowDrag(reading: ReadingControl | undefined, citekeys: readonly string[]) {
  const dragging = useRef<string | null>(null);
  const [over, setOver] = useState<{ citekey: string; place: DropPlace } | null>(null);

  const placeOf = (e: DragEvent<HTMLElement>): DropPlace => {
    const rect = e.currentTarget.getBoundingClientRect();
    return dropPlace(e.clientY - rect.top, rect.height);
  };

  return {
    /** Props for the handle of a row. */
    handleProps: (citekey: string, row: () => HTMLElement | null) => ({
      draggable: true,
      onDragStart: (e: DragEvent<HTMLElement>) => {
        dragging.current = citekey;
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", citekey);
          const element = row();
          if (element && e.dataTransfer.setDragImage) e.dataTransfer.setDragImage(element, 0, 0);
        }
      },
      onDragEnd: () => {
        dragging.current = null;
        setOver(null);
      },
    }),
    /** Props for a row, which takes the drop. */
    rowProps: (citekey: string) => ({
      onDragOver: (e: DragEvent<HTMLElement>) => {
        if (!reading || !dragging.current || dragging.current === citekey) return;
        e.preventDefault();
        const place = placeOf(e);
        setOver((o) => (o?.citekey === citekey && o.place === place ? o : { citekey, place }));
      },
      onDragLeave: () => setOver((o) => (o?.citekey === citekey ? null : o)),
      onDrop: (e: DragEvent<HTMLElement>) => {
        const drag = dragging.current;
        dragging.current = null;
        setOver(null);
        if (!reading || !drag || drag === citekey) return;
        e.preventDefault();
        const from = citekeys.indexOf(drag);
        const target = citekeys.indexOf(citekey);
        if (from < 0 || target < 0) return;
        reading.onMove(drag, dropPosition(from, target, placeOf(e)));
      },
    }),
    /** The drop line to draw on a row. */
    dropClass: (citekey: string) =>
      over?.citekey === citekey
        ? over.place === "before"
          ? "[&>td]:shadow-[inset_0_2px_0_var(--ink)]"
          : "[&>td]:shadow-[inset_0_-2px_0_var(--ink)]"
        : "",
  };
}

/** The position of an item in the order with the handle that moves it: drag, or the arrow keys. */
export function ReadingHandle({
  citekey,
  title,
  index,
  total,
  onMove,
  dragProps,
}: {
  citekey: string;
  title: string;
  index: number;
  total: number;
  onMove: ReadingControl["onMove"];
  dragProps: ReturnType<ReturnType<typeof useRowDrag>["handleProps"]>;
}) {
  const { t } = useI18n();
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    e.stopPropagation();
    const to = e.key === "ArrowUp" ? index - 1 : index + 1;
    if (to >= 0 && to < total) onMove(citekey, to, { keepFocus: true });
  };
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        data-reading-handle={citekey}
        aria-label={t("reading.handle", { title })}
        onKeyDown={onKeyDown}
        className="-ml-1.5 inline-flex size-6 cursor-grab items-center justify-center text-muted hover:bg-sunken hover:text-ink active:cursor-grabbing"
        {...dragProps}
      >
        <GripVertical aria-hidden="true" className="size-3.5" />
      </button>
      <span className="w-5 text-right font-mono text-[12px] text-muted">{index + 1}</span>
    </div>
  );
}

/** The input for a note: Enter or leaving it saves, Escape drops the change. */
function NoteInput({
  citekey,
  title,
  note,
  onEdit,
  onSave,
}: {
  citekey: string;
  title: string;
  note: string | undefined;
  onEdit: (citekey: string | undefined) => void;
  onSave: (citekey: string, note: string) => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(note ?? "");
  const done = useRef(false);
  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    if (save && draft.trim() !== (note ?? "")) onSave(citekey, draft);
    onEdit(undefined);
  };
  return (
    <input
      // biome-ignore lint/a11y/noAutofocus: the input appears because the person asked for it
      autoFocus
      type="text"
      value={draft}
      maxLength={300}
      aria-label={t("reading.noteLabel", { title })}
      placeholder={t("reading.notePlaceholder")}
      onChange={(e) => setDraft(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        if (e.key === "Enter") finish(true);
        else if (e.key === "Escape") finish(false);
      }}
      className="mt-0.5 h-6 w-full max-w-[520px] border border-line bg-bg px-1.5 text-[12px] outline-none focus:border-ink"
    />
  );
}

/**
 * The note on why an item stands where it does: a line under the title that opens an input when it
 * is clicked. An entry without a note shows nothing; the row menu adds one.
 */
export function ReadingNote({
  citekey,
  title,
  note,
  editing,
  onEdit,
  onSave,
}: {
  citekey: string;
  title: string;
  note: string | undefined;
  editing: boolean;
  onEdit: (citekey: string | undefined) => void;
  onSave: (citekey: string, note: string) => void;
}) {
  const { t } = useI18n();
  if (editing) {
    return (
      <NoteInput citekey={citekey} title={title} note={note} onEdit={onEdit} onSave={onSave} />
    );
  }
  if (!note) return null;
  return (
    <button
      type="button"
      title={t("reading.editNote")}
      aria-label={`${t("reading.editNote")}: ${note}`}
      onClick={(e) => {
        e.stopPropagation();
        onEdit(citekey);
      }}
      className="mt-0.5 block max-w-full truncate text-left text-[12px] text-muted hover:text-ink"
    >
      {note}
    </button>
  );
}
