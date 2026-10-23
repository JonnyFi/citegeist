import { projectsList } from "@citegeist/ops";
import { BookOpen } from "lucide-react";
import { useI18n } from "../i18n";
import { useItemPages, useOp } from "../lib/hooks";
import { ItemsTable } from "./items-table";
import { Button } from "./ui/button";
import { Segmented } from "./ui/segmented";
import { Select } from "./ui/select";
import { EmptyState, ErrorState, Loading } from "./ui/states";

export interface ItemFilters {
  project?: string | undefined;
  status?: "unread" | "reading" | "read" | undefined;
}

/** The library: items outside the inbox, narrowed by project and reading status. */
export function ItemsScreen({
  filters,
  onFiltersChange,
}: {
  filters: ItemFilters;
  onFiltersChange: (next: ItemFilters) => void;
}) {
  const { t, tn } = useI18n();
  const projects = useOp(projectsList, {});
  const pages = useItemPages({
    inbox: false,
    limit: 50,
    ...(filters.project ? { project: filters.project } : {}),
    ...(filters.status ? { status: filters.status } : {}),
  });

  const items = pages.data?.pages.flatMap((p) => p.items) ?? [];
  const filtered = filters.project !== undefined || filters.status !== undefined;

  return (
    <div className="mx-auto w-full max-w-5xl px-8 py-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <h1 className="font-serif text-2xl font-semibold">{t("nav.library")}</h1>
        <div className="flex flex-wrap items-center gap-3">
          <Select
            label={t("filter.project")}
            value={filters.project ?? "all"}
            onChange={(v) => onFiltersChange({ ...filters, project: v === "all" ? undefined : v })}
            options={[
              { value: "all", label: t("filter.allProjects") },
              ...(projects.data?.projects ?? []).map((p) => ({ value: p.slug, label: p.title })),
            ]}
          />
          <Segmented
            label={t("filter.status")}
            value={filters.status ?? "any"}
            onChange={(v) => onFiltersChange({ ...filters, status: v === "any" ? undefined : v })}
            options={[
              { value: "any", label: t("filter.all") },
              { value: "unread", label: t("status.unread") },
              { value: "reading", label: t("status.reading") },
              { value: "read", label: t("status.read") },
            ]}
          />
        </div>
      </header>

      {pages.isPending ? (
        <Loading label={t("items.loading")} />
      ) : pages.isError ? (
        <ErrorState error={pages.error} />
      ) : items.length === 0 ? (
        filtered ? (
          <EmptyState
            icon={<BookOpen className="size-6" />}
            title={t("items.noMatch")}
            action={<Button onClick={() => onFiltersChange({})}>{t("items.clearFilters")}</Button>}
          />
        ) : (
          <EmptyState
            icon={<BookOpen className="size-6" />}
            title={t("items.emptyTitle")}
            description={t("items.emptyDescription")}
          />
        )
      ) : (
        <>
          <ItemsTable items={items} />
          <div className="mt-4 flex items-center justify-between text-muted">
            <span>{tn("items.count", items.length)}</span>
            {pages.hasNextPage ? (
              <Button
                disabled={pages.isFetchingNextPage}
                onClick={() => void pages.fetchNextPage()}
              >
                {t("items.loadMore")}
              </Button>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
