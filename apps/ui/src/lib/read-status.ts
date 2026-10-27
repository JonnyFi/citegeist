import { itemsSetStatus } from "@citegeist/ops";
import type { ItemStatus } from "@citegeist/schema";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useToast } from "../components/ui/toast";
import { useI18n } from "../i18n";
import { useCore } from "./hooks";
import { describeError } from "./utils";

/** The order a click on the status square goes through: unread, reading, read, unread. */
export const STATUS_CYCLE: readonly ItemStatus[] = ["unread", "reading", "read"];

export function nextStatus(status: string): ItemStatus {
  const at = STATUS_CYCLE.indexOf(status as ItemStatus);
  return STATUS_CYCLE[(at + 1) % STATUS_CYCLE.length] ?? "unread";
}

/** A status the table or the item view knows; anything else counts as unread. */
export function asStatus(status: string): ItemStatus {
  return STATUS_CYCLE.find((s) => s === status) ?? "unread";
}

/**
 * Sets the reading status of items with items.setStatus: one call, whatever the number of items.
 * Resolves with the citekeys that changed, or undefined when the call failed (a toast says why).
 * With `from`, only items that have one of these statuses change.
 */
export function useSetStatus() {
  const core = useCore();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { t } = useI18n();
  return useCallback(
    async (
      citekeys: readonly string[],
      status: ItemStatus,
      from?: readonly ItemStatus[],
    ): Promise<string[] | undefined> => {
      try {
        const out = await core.call(itemsSetStatus, {
          citekeys: [...citekeys],
          status,
          ...(from ? { from: [...from] } : {}),
        });
        await queryClient.invalidateQueries({ queryKey: ["op"] });
        return out.changed;
      } catch (err) {
        toast.show({ message: t("readStatus.failed", { message: describeError(err).message }) });
        return undefined;
      }
    },
    [core, queryClient, toast, t],
  );
}
