import type { itemsList } from "@citegeist/ops";
import { Link, useNavigate } from "@tanstack/react-router";
import { MoreHorizontal } from "lucide-react";
import type { z } from "zod";
import { useI18n } from "../i18n";
import { statusLabel, typeLabel } from "../lib/format";
import { useTrashItem } from "../lib/trash";
import { RetractionBadge } from "../related";
import { Badge, Stamp, StatusSquare } from "./ui/badge";
import { Menu } from "./ui/menu";

export type ItemSummary = z.output<typeof itemsList.output>["items"][number];

const TH =
  "h-9 border-b border-line px-3 text-left text-label font-semibold uppercase tracking-[0.08em] text-muted";
const TD = "h-row border-b border-line-soft px-3";

/** The library table: 36px head, 40px rows. Titles are links; clicking anywhere in a row opens the item too. */
export function ItemsTable({ items }: { items: readonly ItemSummary[] }) {
  const i18n = useI18n();
  const { t } = i18n;
  const navigate = useNavigate();
  const trash = useTrashItem();
  return (
    <table className="w-full border-collapse text-left text-[13px]">
      <caption className="sr-only">{t("table.caption")}</caption>
      <thead>
        <tr>
          <th scope="col" className={`${TH} w-11 pl-8`}>
            <span className="sr-only">{t("table.status")}</span>
          </th>
          <th scope="col" className={TH}>
            {t("table.title")}
          </th>
          <th scope="col" className={`${TH} hidden w-[200px] md:table-cell`}>
            {t("table.authors")}
          </th>
          <th scope="col" className={`${TH} w-16`}>
            {t("table.year")}
          </th>
          <th scope="col" className={`${TH} hidden w-[110px] lg:table-cell`}>
            {t("table.type")}
          </th>
          <th scope="col" className={`${TH} w-[150px]`}>
            {t("table.status")}
          </th>
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
                if (!e.currentTarget.contains(target) || target.closest("button")) return;
                void navigate({ to: "/items/$citekey", params: { citekey: item.citekey } });
              }}
              className="cursor-default hover:bg-sunken"
            >
              <td className={`${TD} pl-8`}>
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
                  {!item.incomplete && item.fulltext === "missing" ? (
                    <span className="text-[12px] text-muted">{t("item.noFulltext")}</span>
                  ) : null}
                </div>
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
