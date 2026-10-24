import { itemsRestore, itemsTrash } from "@citegeist/ops";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useToast } from "../components/ui/toast";
import { useI18n } from "../i18n";
import { useCore } from "./hooks";
import { describeError } from "./utils";

/**
 * Deletes an item with items.trash and offers to undo it in a toast. The undo calls items.restore,
 * which puts the trashed folder back. Resolves true when the item was trashed.
 */
export function useTrashItem(): (citekey: string) => Promise<boolean> {
  const core = useCore();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { t } = useI18n();
  return useCallback(
    async (citekey) => {
      const refresh = () => queryClient.invalidateQueries({ queryKey: ["op"] });
      try {
        await core.call(itemsTrash, { citekey });
      } catch (err) {
        toast.show({ message: t("item.deleteFailed", { message: describeError(err).message }) });
        return false;
      }
      await refresh();
      toast.show({
        message: t("item.deleted", { citekey }),
        actionLabel: t("item.undo"),
        onAction: async () => {
          try {
            await core.call(itemsRestore, { citekey });
            toast.show({ message: t("item.restored", { citekey }) });
          } catch (err) {
            toast.show({ message: describeError(err).message });
          }
          await refresh();
        },
      });
      return true;
    },
    [core, queryClient, toast, t],
  );
}
