import type { itemsList } from "@citegeist/ops";
import { Link, useNavigate } from "@tanstack/react-router";
import type { z } from "zod";
import { statusLabel, typeLabel } from "../lib/format";
import { Badge } from "./ui/badge";

export type ItemSummary = z.output<typeof itemsList.output>["items"][number];

/** The library table. Titles are links; clicking anywhere in a row opens the item as well. */
export function ItemsTable({ items }: { items: readonly ItemSummary[] }) {
  const navigate = useNavigate();
  return (
    <table className="w-full border-collapse text-left">
      <caption className="sr-only">Items</caption>
      <thead>
        <tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
          <th scope="col" className="w-[44%] py-2 pr-4 font-medium">
            Title
          </th>
          <th scope="col" className="hidden py-2 pr-4 font-medium md:table-cell">
            Authors
          </th>
          <th scope="col" className="py-2 pr-4 font-medium">
            Year
          </th>
          <th scope="col" className="hidden py-2 pr-4 font-medium lg:table-cell">
            Type
          </th>
          <th scope="col" className="py-2 font-medium">
            Status
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
            className="cursor-default border-b border-line/70 hover:bg-sunken/60"
          >
            <td className="max-w-0 py-2.5 pr-4 align-top">
              <Link
                to="/items/$citekey"
                params={{ citekey: item.citekey }}
                onClick={(e) => e.stopPropagation()}
                className="line-clamp-2 font-serif text-[15px] font-medium hover:text-accent"
              >
                {item.title}
              </Link>
              <div className="mt-0.5 font-mono text-xs text-muted">{item.citekey}</div>
            </td>
            <td className="hidden py-2.5 pr-4 align-top text-muted md:table-cell">
              {item.authors ?? ""}
            </td>
            <td className="py-2.5 pr-4 align-top tabular-nums text-muted">{item.year ?? ""}</td>
            <td className="hidden py-2.5 pr-4 align-top text-muted lg:table-cell">
              {typeLabel(item.type)}
            </td>
            <td className="py-2.5 align-top">
              <div className="flex gap-1.5">
                <Badge tone={item.status === "reading" ? "accent" : "neutral"}>
                  {statusLabel(item.status)}
                </Badge>
                {item.inbox ? <Badge tone="outline">Inbox</Badge> : null}
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
