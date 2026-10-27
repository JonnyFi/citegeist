import type { ItemSort, itemsList } from "@citegeist/ops";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowDown, ArrowUp, MoreHorizontal } from "lucide-react";
import type { z } from "zod";
import { useI18n } from "../i18n";
import { statusLabel, typeLabel } from "../lib/format";
import { type LibrarySort, nextSort } from "../lib/library-sort";
import { useTrashItem } from "../lib/trash";
import { RetractionBadge } from "../related";
import { FulltextMarker } from "./fulltext-marker";
import { Badge, Stamp, StatusSquare } from "./ui/badge";
import { Menu } from "./ui/menu";

export type ItemSummary = z.output<typeof itemsList.output>["items"][number];

/** Row selection of the table: a checkbox per row, shift-click on a checkbox takes a range. */
export interface RowSelection {
  selected: ReadonlySet<string>;
  onToggle: (citekey: string, opts: { range: boolean }) => void;
  onToggleAll: () => void;
}

/** The sort the table shows and the way to change it. Without it the headers are plain text. */
export interface SortControl {
  value: LibrarySort;
  onChange: (next: LibrarySort) => void;
}

const TH =
  "h-9 border-b border-line px-3 text-left text-label font-semibold uppercase tracking-[0.08em] text-muted";
function shortDate(iso: string, lang: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime())
    ? ""
    : at.toLocaleDateString(lang, { day: "2-digit", month: "2-digit", year: "numeric" });
}

const TD = "h-row border-b border-line-soft px-3";

/** The library table: 36px head, 40px rows. Titles are links; clicking anywhere in a row opens the item too. */
export function ItemsTable({
  items,
  selection,
  sort,
}: {
  items: readonly ItemSummary[];
  selection?: RowSelection | undefined;
  sort?: SortControl | undefined;
}) {
  const i18n = useI18n();
  const { t } = i18n;
  const navigate = useNavigate();
  const trash = useTrashItem();
  /** A column header: a button that sorts by the column, with aria-sort on the cell. */
  const head = (column: ItemSort, label: string, className: string) => {
    const active = sort?.value.sort === column ? sort.value.order : undefined;
    return (
      <th
        scope="col"
        className={className}
        {...(sort
          ? {
              "aria-sort":
                active === "asc" ? "ascending" : active === "desc" ? "descending" : "none",
            }
          : {})}
      >
        {sort ? (
          <button
            type="button"
            title={t("sort.by", { column: label })}
            onClick={() => sort.onChange(nextSort(sort.value, column))}
            className="-mx-1 inline-flex h-6 items-center gap-1 px-1 uppercase tracking-[0.08em] hover:text-ink"
          >
            {label}
            {active === "asc" ? (
              <ArrowUp className="size-3" aria-hidden="true" />
            ) : active === "desc" ? (
              <ArrowDown className="size-3" aria-hidden="true" />
            ) : null}
          </button>
        ) : (
          label
        )}
      </th>
    );
  };
  return (
    <table className="w-full border-collapse text-left text-[13px]">
      <caption className="sr-only">{t("table.caption")}</caption>
      <thead>
        <tr>
          {selection ? (
            <th scope="col" className={`${TH} w-11 pl-8`}>
              <input
                type="checkbox"
                className="size-3.5 align-middle"
                aria-label={t("membership.selectAll")}
                checked={items.length > 0 && items.every((i) => selection.selected.has(i.citekey))}
                onChange={selection.onToggleAll}
              />
            </th>
          ) : null}
          <th scope="col" className={`${TH} w-11 ${selection ? "pl-0" : "pl-8"}`}>
            <span className="sr-only">{t("table.status")}</span>
          </th>
          {head("title", t("table.title"), TH)}
          {head("authors", t("table.authors"), `${TH} hidden w-[200px] md:table-cell`)}
          {head("year", t("table.year"), `${TH} w-16`)}
          {head("type", t("table.type"), `${TH} hidden w-[110px] lg:table-cell`)}
          {head("status", t("table.status"), `${TH} w-[150px]`)}
          {head("added", t("table.added"), `${TH} hidden w-[110px] lg:table-cell`)}
          <th scope="col" className={`${TH} w-14 pr-8`}>
            <span className="sr-only">{t("table.actions")}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => {
          return (
            <tr
              key={item.citekey}
              data-testid="item-row"
              onClick={(e) => {
                // the row menu and its popup (a portal, whose clicks still bubble) do not open the item
                const target = e.target as HTMLElement;
                if (!e.currentTarget.contains(target) || target.closest("button, input")) return;
                // cmd, ctrl or shift on the row select it instead of opening it
                if (selection && (e.metaKey || e.ctrlKey || e.shiftKey)) {
                  selection.onToggle(item.citekey, { range: e.shiftKey });
                  return;
                }
                void navigate({ to: "/items/$citekey", params: { citekey: item.citekey } });
              }}
              className="cursor-default hover:bg-sunken"
            >
              {selection ? (
                <td className={`${TD} pl-8`}>
                  <input
                    type="checkbox"
                    className="size-3.5 align-middle"
                    aria-label={t("membership.selectRow", { title: item.title })}
                    checked={selection.selected.has(item.citekey)}
                    onChange={() => {}}
                    onClick={(e) => {
                      e.stopPropagation();
                      selection.onToggle(item.citekey, { range: e.shiftKey });
                    }}
                  />
                </td>
              ) : null}
              <td className={`${TD} ${selection ? "pl-0" : "pl-8"}`}>
                <StatusSquare filled={item.status !== "unread"} />
              </td>
              <td className={`${TD} max-w-0`}>
                <div className="flex items-baseline gap-3">
                  <Link
                    to="/items/$citekey"
                    params={{ citekey: item.citekey }}
                    onClick={(e) => e.stopPropagation()}
                    className="min-w-0 truncate font-medium hover:underline"
                  >
                    {item.title}
                  </Link>
                  {item.retraction ? (
                    <RetractionBadge marker={item.retraction} className="shrink-0" />
                  ) : null}
                  <span className="hidden shrink-0 font-mono text-[11px] text-muted xl:inline">
                    {item.citekey}
                  </span>
                </div>
              </td>
              <td className={`${TD} hidden truncate md:table-cell`}>{item.authors ?? ""}</td>
              <td className={`${TD} font-mono text-[12px]`}>{item.year ?? ""}</td>
              <td className={`${TD} hidden lg:table-cell`}>{typeLabel(i18n, item.type)}</td>
              <td className={TD}>
                <div className="flex items-center gap-2">
                  <span>{statusLabel(i18n, item.status)}</span>
                  {item.inbox ? <Badge tone="outline">{t("nav.inbox")}</Badge> : null}
                  {item.incomplete ? (
                    <span title={item.incompleteReason}>
                      <Stamp tone="danger">{t("item.incomplete")}</Stamp>
                    </span>
                  ) : null}
                  {!item.authors || !item.year ? (
                    <span title={t("item.metadataMissing.hint")}>
                      <Stamp>{t("item.metadataMissing")}</Stamp>
                    </span>
                  ) : null}
                  <FulltextMarker item={item} />
                </div>
              </td>
              <td className={`${TD} hidden font-mono text-[12px] text-muted lg:table-cell`}>
                {item.added ? shortDate(item.added, i18n.lang) : ""}
              </td>
              <td className={`${TD} pr-8 text-right`}>
                <Menu
                  label={t("row.menu", { title: item.title })}
                  trigger={<MoreHorizontal className="size-4" />}
                  align="end"
                  className="inline-flex size-6 items-center justify-center text-muted hover:bg-sunken hover:text-ink"
                  entries={[
                    {
                      label: t("item.delete"),
                      danger: true,
                      onSelect: () => void trash(item.citekey),
                    },
                  ]}
                />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
