import type { ItemStatus } from "@citegeist/schema";
import { ChevronDown } from "lucide-react";
import { useI18n } from "../i18n";
import { statusLabel } from "../lib/format";
import { STATUS_CYCLE, useSetStatus } from "../lib/read-status";
import { cn } from "../lib/utils";
import { badgeVariants, StatusSquare } from "./ui/badge";
import { Menu } from "./ui/menu";

/**
 * The status chip of an item as a control: a click opens a menu with the three statuses.
 * It looks like the chip it replaces, with a small chevron.
 */
export function StatusControl({ citekey, status }: { citekey: string; status: ItemStatus }) {
  const i18n = useI18n();
  const { t } = i18n;
  const setStatus = useSetStatus();
  const unread = status === "unread";
  return (
    <Menu
      label={t("readStatus.change", { status: statusLabel(i18n, status) })}
      className={cn(
        badgeVariants({ tone: unread ? "outline" : "accent" }),
        "cursor-default hover:opacity-85",
      )}
      trigger={
        <>
          <StatusSquare filled={!unread} className={unread ? "" : "border-bg bg-bg"} />
          {statusLabel(i18n, status)}
          <ChevronDown aria-hidden="true" className="size-3 opacity-70" />
        </>
      }
      entries={STATUS_CYCLE.map((s) => ({
        label: statusLabel(i18n, s),
        checked: s === status,
        onSelect: () => {
          if (s !== status) void setStatus([citekey], s);
        },
      }))}
    />
  );
}
