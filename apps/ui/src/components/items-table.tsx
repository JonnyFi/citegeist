import type { itemsList } from "@citegeist/ops";
import { Link, useNavigate } from "@tanstack/react-router";
import type { z } from "zod";
import { useI18n } from "../i18n";
import { statusLabel, typeLabel } from "../lib/format";
import { Badge, StatusSquare } from "./ui/badge";

export type ItemSummary = z.output<typeof itemsList.output>["items"][number];

const TH =
  "h-9 border-b border-line px-3 text-left text-label font-semibold uppercase tracking-[0.08em] text-muted";
const TD = "h-row border-b border-line-soft px-3";

/** The library table: 36px head, 40px rows. Titles are links; clicking anywhere in a row opens the item too. */
export function ItemsTable({ items }: { items: readonly ItemSummary[] }) {
  const i18n = useI18n();
  const { t } = i18n;
  const navigate = useNavigate();
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
          <th scope="col" className={`${TH} w-[150px] pr-8`}>
            {t("table.status")}
          </th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr
            key={item.citekey}
            data-testid="item-row"
            onClick={() =>
              void navigate({ to: "/items/$citekey", params: { citekey: item.citekey } })
            }
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
                <span className="hidden shrink-0 font-mono text-[11px] text-muted xl:inline">
                  {item.citekey}
                </span>
              </div>
            </td>
            <td className={`${TD} hidden truncate md:table-cell`}>{item.authors ?? ""}</td>
            <td className={`${TD} font-mono text-[12px]`}>{item.year ?? ""}</td>
            <td className={`${TD} hidden lg:table-cell`}>{typeLabel(i18n, item.type)}</td>
            <td className={`${TD} pr-8`}>
              <div className="flex items-center gap-2">
                <span>{statusLabel(i18n, item.status)}</span>
                {item.inbox ? <Badge tone="outline">{t("nav.inbox")}</Badge> : null}
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
