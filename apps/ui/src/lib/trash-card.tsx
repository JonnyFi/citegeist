import { cardsDelete, cardsRestore } from "@citegeist/ops";
import { useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useCallback, useRef, useState } from "react";
import { DeleteCardDialog, type ReferenceCounts } from "../components/delete-card-dialog";
import { useToast } from "../components/ui/toast";
import { useI18n } from "../i18n";
import { useCore } from "./hooks";
import { describeError } from "./utils";

/** The counts that the core puts into the error of a refused delete (zero where it says nothing). */
function countsOf(context: Record<string, unknown> | undefined): ReferenceCounts {
  const count = (key: string) => {
    const n = context?.[key];
    return typeof n === "number" ? n : 0;
  };
  return {
    notes: count("notes"),
    cards: count("cards"),
    links: count("links"),
    mentions: count("mentions"),
  };
}

/**
 * Deletes a card with cards.delete and offers to undo it in a toast. The undo calls cards.restore,
 * which puts the file back from the library trash, together with the links that went with it. A
 * card that notes or links refer to is first refused by the core; the app then shows what a delete
 * takes with it and calls again with `force` once the person confirms. `trash` resolves true when
 * the card was deleted; `dialog` is the confirmation to render next to the caller.
 */
export function useTrashCard(): { trash: (id: string) => Promise<boolean>; dialog: ReactNode } {
  const core = useCore();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { t } = useI18n();
  const [asking, setAsking] = useState<ReferenceCounts | null>(null);
  const answer = useRef<((confirmed: boolean) => void) | null>(null);

  const confirm = useCallback((counts: ReferenceCounts) => {
    return new Promise<boolean>((resolve) => {
      answer.current = resolve;
      setAsking(counts);
    });
  }, []);
  const settle = (confirmed: boolean) => {
    setAsking(null);
    answer.current?.(confirmed);
    answer.current = null;
  };

  const trash = useCallback(
    async (id: string) => {
      const refresh = () => queryClient.invalidateQueries({ queryKey: ["op"] });
      const fail = (err: unknown) =>
        toast.show({ message: t("hl.deleteFailed", { message: describeError(err).message }) });
      try {
        await core.call(cardsDelete, { id });
      } catch (err) {
        const described = describeError(err);
        if (described.code !== "CARD_REFERENCED") {
          fail(err);
          return false;
        }
        if (!(await confirm(countsOf(described.context)))) return false;
        try {
          await core.call(cardsDelete, { id, force: true });
        } catch (forced) {
          fail(forced);
          return false;
        }
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
    [core, queryClient, toast, t, confirm],
  );

  const dialog = asking ? (
    <DeleteCardDialog
      counts={asking}
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  ) : null;
  return { trash, dialog };
}
