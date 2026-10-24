import { BookOpen } from "lucide-react";
import { useI18n } from "../i18n";
import { useItemPages } from "../lib/hooks";
import { ItemsTable } from "./items-table";
import { Button } from "./ui/button";
import { EmptyState, ErrorState, Loading } from "./ui/states";

/** The reading list inside a project: the library table, filtered by the project. */
export function ProjectReadingList({ slug }: { slug: string }) {
  const { t } = useI18n();
  const pages = useItemPages({ inbox: false, limit: 50, project: slug });
  const items = pages.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {pages.isPending ? (
        <Loading label={t("items.loading")} />
      ) : pages.isError ? (
        <ErrorState error={pages.error} />
      ) : items.length === 0 ? (
        <EmptyState icon={<BookOpen />} title={t("project.noItems")} />
      ) : (
        <>
          <ItemsTable items={items} />
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
