import { useRef, useState } from "react";
import { useI18n } from "../i18n";
import { useSetStatus } from "../lib/read-status";
import { type ItemSummary, ItemsTable, type RowSelection, type SortControl } from "./items-table";
import { ProjectPicker, useProjectMembership } from "./project-membership";
import { Button } from "./ui/button";
import { useToast } from "./ui/toast";

/** Selection of table rows. Rows that left the list drop out of it by themselves. */
export function useRowSelection(items: readonly ItemSummary[]) {
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const anchor = useRef<string | undefined>(undefined);
  const keys = items.map((i) => i.citekey);
  const chosen = keys.filter((k) => picked.has(k));

  const selection: RowSelection = {
    selected: new Set(chosen),
    onToggle: (citekey, { range }) => {
      const from = anchor.current === undefined ? -1 : keys.indexOf(anchor.current);
      const to = keys.indexOf(citekey);
      anchor.current = citekey;
      setPicked((prev) => {
        const next = new Set(prev);
        if (range && from >= 0) {
          for (const k of keys.slice(Math.min(from, to), Math.max(from, to) + 1)) next.add(k);
        } else if (!next.delete(citekey)) {
          next.add(citekey);
        }
        return next;
      });
    },
    onToggleAll: () => setPicked(chosen.length === keys.length ? new Set() : new Set(keys)),
  };
  return { selection, chosen, clear: () => setPicked(new Set()) };
}

/**
 * Appears above the table once rows are selected: put them into a project, and, when the list is
 * filtered by a project, take them out of it.
 */
export function SelectionBar({
  citekeys,
  project,
  onDone,
}: {
  citekeys: readonly string[];
  project?: string | undefined;
  onDone: () => void;
}) {
  const { t, tn } = useI18n();
  const change = useProjectMembership();
  const setStatus = useSetStatus();
  const toast = useToast();
  const mark = async (status: "read" | "unread") => {
    const changed = await setStatus(citekeys, status);
    if (changed === undefined) return;
    toast.show({
      message:
        changed.length === 0
          ? t("readStatus.unchanged")
          : tn(
              status === "read" ? "readStatus.markedRead" : "readStatus.markedUnread",
              changed.length,
            ),
    });
    onDone();
  };
  return (
    <div
      role="toolbar"
      aria-label={t("membership.selectionBar")}
      className="flex min-h-10 items-center gap-4 border-b border-line bg-sunken px-8 py-1.5 text-[12px]"
    >
      <span className="font-medium">{tn("membership.selected", citekeys.length)}</span>
      <ProjectPicker
        label={t("membership.addToProject")}
        trigger={t("membership.addToProject")}
        exclude={project ? [project] : []}
        className="inline-flex h-[26px] items-center border border-ink px-2.5 text-[12px] font-medium hover:bg-bg"
        onPick={async (slug, title) => {
          if (await change("add", slug, citekeys, title)) onDone();
        }}
      />
      {project ? (
        <Button
          size="sm"
          onClick={async () => {
            if (await change("remove", project, citekeys)) onDone();
          }}
        >
          {t("membership.removeFromProject")}
        </Button>
      ) : null}
      <Button size="sm" onClick={() => void mark("read")}>
        {t("readStatus.markRead")}
      </Button>
      <Button size="sm" onClick={() => void mark("unread")}>
        {t("readStatus.markUnread")}
      </Button>
      <span className="flex-1" />
      <Button size="sm" variant="ghost" onClick={onDone}>
        {t("membership.clear")}
      </Button>
    </div>
  );
}

/** The library table with row selection and its action bar. */
export function SelectableItemsTable({
  items,
  project,
  sort,
}: {
  items: readonly ItemSummary[];
  /** The project the list is filtered by, if any. */
  project?: string | undefined;
  sort?: SortControl | undefined;
}) {
  const { selection, chosen, clear } = useRowSelection(items);
  return (
    <>
      {chosen.length > 0 ? (
        <SelectionBar citekeys={chosen} project={project} onDone={clear} />
      ) : null}
      <ItemsTable items={items} selection={selection} sort={sort} />
    </>
  );
}
