import { cardsDelete, cardsRestore } from "@citegeist/ops";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useToast } from "../components/ui/toast";
import { useI18n } from "../i18n";
import { useCore } from "./hooks";
import { describeError } from "./utils";

/**
 * Deletes a card with cards.delete and offers to undo it in a toast. The undo calls cards.restore,
 * which puts the file back from the library trash. Resolves true when the card was deleted.
 */
export function useTrashCard(): (id: string) => Promise<boolean> {
  const core = useCore();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { t } = useI18n();
  return useCallback(
    async (id) => {
      const refresh = () => queryClient.invalidateQueries({ queryKey: ["op"] });
      try {
        await core.call(cardsDelete, { id });
      } catch (err) {
        toast.show({ message: t("hl.deleteFailed", { message: describeError(err).message }) });
        return false;
      }
      await refresh();
      toast.show({
        message: t("hl.deleted"),
        actionLabel: t("item.undo"),
        onAction: async () => {
          try {
            await core.call(cardsRestore, { id });
            toast.show({ message: t("hl.restored") });
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
