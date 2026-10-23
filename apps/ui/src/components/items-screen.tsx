import { inboxAccept, inboxReject, projectsList } from "@citegeist/ops";
import { BookOpen, Inbox } from "lucide-react";
import { useItemPages, useOp, useOpMutation } from "../lib/hooks";
import { ItemsTable } from "./items-table";
import { Button } from "./ui/button";
import { Segmented } from "./ui/segmented";
import { Select } from "./ui/select";
import { EmptyState, ErrorState, Loading } from "./ui/states";

export interface ItemFilters {
  project?: string | undefined;
  status?: "unread" | "reading" | "read" | undefined;
}

const STATUS_OPTIONS = [
  { value: "any", label: "All" },
  { value: "unread", label: "Unread" },
  { value: "reading", label: "Reading" },
  { value: "read", label: "Read" },
] as const;

/** Library and inbox: the same table, scoped by `mode` and narrowed by project and status. */
export function ItemsScreen({
  mode,
  filters,
  onFiltersChange,
}: {
  mode: "library" | "inbox";
  filters: ItemFilters;
  onFiltersChange: (next: ItemFilters) => void;
}) {
  const projects = useOp(projectsList, {});
  const pages = useItemPages({
    inbox: mode === "inbox",
    limit: 50,
    ...(filters.project ? { project: filters.project } : {}),
    ...(filters.status ? { status: filters.status } : {}),
  });
  const accept = useOpMutation(inboxAccept);
  const reject = useOpMutation(inboxReject);

  const items = pages.data?.pages.flatMap((p) => p.items) ?? [];
  const filtered = filters.project !== undefined || filters.status !== undefined;

  return (
    <div className="mx-auto w-full max-w-5xl px-8 py-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <h1 className="font-serif text-2xl font-semibold">
          {mode === "inbox" ? "Inbox" : "Library"}
        </h1>
        <div className="flex flex-wrap items-center gap-3">
          <Select
            label="Project"
            value={filters.project ?? "all"}
            onChange={(v) => onFiltersChange({ ...filters, project: v === "all" ? undefined : v })}
            options={[
              { value: "all", label: "All projects" },
              ...(projects.data?.projects ?? []).map((p) => ({ value: p.slug, label: p.title })),
            ]}
          />
          <Segmented
            label="Reading status"
            value={filters.status ?? "any"}
            onChange={(v) => onFiltersChange({ ...filters, status: v === "any" ? undefined : v })}
            options={STATUS_OPTIONS}
          />
        </div>
      </header>

      {mode === "inbox" && items.length > 0 ? (
        <div className="mb-4 flex items-center gap-2">
          <Button
            variant="primary"
            size="sm"
            disabled={accept.isPending}
            onClick={() => accept.mutate({ citekeys: items.map((i) => i.citekey) })}
          >
            Accept all
          </Button>
          <Button
            size="sm"
            disabled={reject.isPending}
            onClick={() => reject.mutate({ citekeys: items.map((i) => i.citekey) })}
          >
            Discard all
          </Button>
          {accept.error || reject.error ? (
            <span role="alert" className="text-danger">
              {(accept.error ?? reject.error)?.message}
            </span>
          ) : null}
        </div>
      ) : null}

      {pages.isPending ? (
        <Loading label="Loading items" />
      ) : pages.isError ? (
        <ErrorState error={pages.error} />
      ) : items.length === 0 ? (
        mode === "inbox" ? (
          <EmptyState
            icon={<Inbox className="size-6" />}
            title="The inbox is empty"
            description="Papers that agents find for you wait here until you accept them."
          />
        ) : filtered ? (
          <EmptyState
            icon={<BookOpen className="size-6" />}
            title="No items match these filters"
            action={<Button onClick={() => onFiltersChange({})}>Clear filters</Button>}
          />
        ) : (
          <EmptyState
            icon={<BookOpen className="size-6" />}
            title="Your library is empty"
            description="Drop a PDF into the window, paste a DOI or share an arXiv link to add the first paper."
          />
        )
      ) : (
        <>
          <ItemsTable items={items} />
          <div className="mt-4 flex items-center justify-between text-muted">
            <span>
              {items.length} {items.length === 1 ? "item" : "items"}
            </span>
            {pages.hasNextPage ? (
              <Button
                disabled={pages.isFetchingNextPage}
                onClick={() => void pages.fetchNextPage()}
              >
                Load more
              </Button>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
