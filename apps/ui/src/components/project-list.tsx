import { BookOpen } from "lucide-react";
import { useState } from "react";
import { useI18n } from "../i18n";
import { useItemPages } from "../lib/hooks";
import { useLibrarySort } from "../lib/library-sort";
import { AddSources } from "./add-sources";
import { SelectableItemsTable } from "./item-selection";
import { Button } from "./ui/button";
import { EmptyState, ErrorState, Loading } from "./ui/states";

/** The reading list inside a project: the library table, filtered by the project. */
export function ProjectReadingList({ slug }: { slug: string }) {
  const { t } = useI18n();
  const [sort, setSort] = useLibrarySort();
  const pages = useItemPages({
    inbox: false,
    limit: 50,
    project: slug,
    sort: sort.sort,
    order: sort.order,
  });
  const [adding, setAdding] = useState(false);
  const items = pages.data?.pages.flatMap((p) => p.items) ?? [];
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
        <div className="flex justify-end px-8 pt-3">{addButton}</div>
      ) : null}
      {pages.isPending ? (
        <Loading label={t("items.loading")} />
      ) : pages.isError ? (
        <ErrorState error={pages.error} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<BookOpen />}
          title={t("project.noItems")}
          action={adding ? undefined : addButton}
        />
      ) : (
        <>
          <SelectableItemsTable
            items={items}
            project={slug}
            sort={{ value: sort, onChange: setSort }}
          />
          {pages.hasNextPage ? (
            <div className="px-8 py-4">
              <Button
                disabled={pages.isFetchingNextPage}
                onClick={() => void pages.fetchNextPage()}
              >
                {t("items.loadMore")}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
