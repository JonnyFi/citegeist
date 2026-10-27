import { useI18n } from "../i18n";
import type { ItemSummary } from "./items-table";

/**
 * "ohne Volltext": the compact marker of an item whose full text lookup found no file. The
 * library table and the inbox rows show it the same way. An item that failed to import carries the
 * stronger "unvollständig" stamp instead.
 */
export function FulltextMarker({ item }: { item: Pick<ItemSummary, "incomplete" | "fulltext"> }) {
  const { t } = useI18n();
  if (item.incomplete || item.fulltext !== "missing") return null;
  return <span className="text-[12px] text-muted">{t("item.noFulltext")}</span>;
}
