import { notesRestore, notesTrash } from "@citegeist/ops";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import { useToast } from "../components/ui/toast";
import { useI18n } from "../i18n";
import { useCore } from "../lib/hooks";
import { describeError } from "../lib/utils";

/**
 * Deletes a note with notes.trash, goes back to the notes list and offers to undo it in a toast.
 * The undo calls notes.restore and opens the note again. Resolves true when the note was trashed.
 */
export function useTrashNote(): (id: string, title: string) => Promise<boolean> {
  const core = useCore();
  const queryClient = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const { t } = useI18n();
  return useCallback(
    async (id, title) => {
      const refresh = () => queryClient.invalidateQueries({ queryKey: ["op"] });
      try {
        await core.call(notesTrash, { id });
      } catch (err) {
        toast.show({ message: t("notes.deleteFailed", { message: describeError(err).message }) });
        return false;
      }
      await navigate({ to: "/notes" });
      await refresh();
      toast.show({
        message: t("notes.deleted", { title }),
        actionLabel: t("item.undo"),
        onAction: async () => {
          try {
            await core.call(notesRestore, { id });
            toast.show({ message: t("notes.restored", { title }) });
            await refresh();
            await navigate({ to: "/notes/$id", params: { id } });
          } catch (err) {
            toast.show({ message: describeError(err).message });
          }
        },
      });
      return true;
    },
    [core, queryClient, toast, navigate, t],
  );
}
