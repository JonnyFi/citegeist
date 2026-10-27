import { projectsList } from "@citegeist/ops";
import { Link } from "@tanstack/react-router";
import { BookOpen } from "lucide-react";
import { useI18n } from "../i18n";
import { useItemPages, useOp } from "../lib/hooks";
import { AddField } from "./add-field";
import { FirstSteps } from "./first-steps";
import { SelectableItemsTable } from "./item-selection";
import { HeaderSlot, SubBar } from "./layout";
import { Button } from "./ui/button";
import { Segmented } from "./ui/segmented";
import { Select } from "./ui/select";
import { EmptyState, ErrorState, Loading } from "./ui/states";

export interface ItemFilters {
  project?: string | undefined;
  status?: "unread" | "reading" | "read" | undefined;
  /** Show the items that wait in the inbox as well, marked. */
  inbox?: boolean | undefined;
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
    ...(filters.inbox ? { includeInbox: true } : { inbox: false }),
    limit: 50,
    ...(filters.project ? { project: filters.project } : {}),
    ...(filters.status ? { status: filters.status } : {}),
  });

  const items = pages.data?.pages.flatMap((p) => p.items) ?? [];
  const filtered =
    filters.project !== undefined || filters.status !== undefined || filters.inbox === true;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <HeaderSlot>
        {filters.project ? (
          <nav
            aria-label={t("item.breadcrumb")}
            className="flex min-w-0 items-center gap-2 whitespace-nowrap text-muted"
          >
            <Link to="/projects" className="hover:text-ink">
              {t("nav.projects")}
            </Link>
            <span aria-hidden="true">/</span>
            <Link
              to="/projects/$slug"
              params={{ slug: filters.project }}
              className="truncate hover:text-ink"
            >
              {projects.data?.projects.find((p) => p.slug === filters.project)?.title ??
                filters.project}
            </Link>
            <span aria-hidden="true">/</span>
            <h1 className="text-[13px] font-medium text-ink">{t("project.readingList")}</h1>
          </nav>
        ) : (
          <h1 className="text-[13px] font-medium">{t("nav.library")}</h1>
        )}
        {pages.data ? (
          <span className="font-mono text-[12px] text-muted">
            {tn("items.count", items.length)}
          </span>
        ) : null}
        <span className="flex-1" />
        <AddField project={filters.project} />
      </HeaderSlot>
      <SubBar className="items-center">
        <div className="flex items-center gap-5 text-[12px]">
          <div className="flex items-center gap-2">
            <span className="text-muted">{t("filter.project")}</span>
            <Select
              label={t("filter.project")}
              value={filters.project ?? "all"}
              active={filters.project !== undefined}
              onChange={(v) =>
                onFiltersChange({ ...filters, project: v === "all" ? undefined : v })
              }
              options={[
                { value: "all", label: t("filter.allProjects") },
                ...(projects.data?.projects ?? []).map((p) => ({ value: p.slug, label: p.title })),
              ]}
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted">{t("filter.status")}</span>
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
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              className="size-3.5"
              checked={filters.inbox === true}
              onChange={(e) =>
                onFiltersChange({ ...filters, inbox: e.target.checked ? true : undefined })
              }
            />
            {t("filter.includeInbox")}
          </label>
        </div>
        {pages.data ? (
          <span className="flex items-center font-mono text-[12px] text-muted">
            {tn("items.matches", items.length)}
          </span>
        ) : null}
      </SubBar>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {pages.isPending ? (
          <Loading label={t("items.loading")} />
        ) : pages.isError ? (
          <ErrorState error={pages.error} />
        ) : items.length === 0 ? (
          filtered ? (
            <EmptyState
              icon={<BookOpen />}
              title={t("items.noMatch")}
              action={
                <Button onClick={() => onFiltersChange({})}>{t("items.clearFilters")}</Button>
              }
            />
          ) : (
            <FirstSteps />
          )
        ) : (
          <>
            <SelectableItemsTable items={items} project={filters.project} />
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
    </div>
  );
}
