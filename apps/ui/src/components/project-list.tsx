import { useNavigate } from "@tanstack/react-router";
import { BookOpen } from "lucide-react";
import { useMemo, useState } from "react";
import { useI18n } from "../i18n";
import { useReadingList } from "../lib/reading-order";
import { AddSources } from "./add-sources";
import { SelectableItemsTable } from "./item-selection";
import type { ReadingControl } from "./reading-rows";
import { Button } from "./ui/button";
import { EmptyState, ErrorState, Loading } from "./ui/states";

/**
 * The reading list inside a project: the project's items in the order the person chose, with
 * the progress, a way to open the next text and the notes on why each one stands where it does.
 */
export function ProjectReadingList({ slug }: { slug: string }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { list, move, setNote, announcement, progress } = useReadingList(slug);
  const [adding, setAdding] = useState(false);
  const entries = list.data?.entries;
  const items = useMemo(() => entries?.map((e) => e.item) ?? [], [entries]);
  const reading = useMemo<ReadingControl>(
    () => ({
      notes: new Map((entries ?? []).flatMap((e) => (e.note ? [[e.item.citekey, e.note]] : []))),
      onMove: (citekey, position, opts) => void move(citekey, position, opts),
      onNote: (citekey, note) => void setNote(citekey, note),
    }),
    [entries, move, setNote],
  );
  const next = items.find((i) => i.citekey === list.data?.next);
  const addButton = (
    <Button size="sm" onClick={() => setAdding(true)}>
      {t("membership.addSources")}
    </Button>
  );
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {adding ? (
        <AddSources slug={slug} onClose={() => setAdding(false)} />
      ) : items.length > 0 ? (
        <div className="flex items-center gap-4 px-8 pt-3">
          <span className="font-mono text-[12px] text-muted">{progress}</span>
          <span className="flex-1" />
          {next ? (
            <Button
              size="sm"
              variant="primary"
              title={t("reading.nextTitle", { title: next.title })}
              onClick={() =>
                void navigate({ to: "/items/$citekey", params: { citekey: next.citekey } })
              }
            >
              {t("reading.next")}
            </Button>
          ) : (
            <span className="text-[12px] text-muted">{t("reading.allRead")}</span>
          )}
          {addButton}
        </div>
      ) : null}
      <div role="status" className="sr-only">
        {announcement}
      </div>
      {list.isPending ? (
        <Loading label={t("items.loading")} />
      ) : list.isError ? (
        <ErrorState error={list.error} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<BookOpen />}
          title={t("project.noItems")}
          action={adding ? undefined : addButton}
        />
      ) : (
        <SelectableItemsTable items={items} project={slug} reading={reading} />
      )}
    </div>
  );
}
