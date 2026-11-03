import { AlertDialog } from "@base-ui/react/alert-dialog";
import { useI18n } from "../i18n";
import { Button } from "./ui/button";

/** What the core counted around a card that is about to be deleted (see CARD_REFERENCED). */
export interface ReferenceCounts {
  /** Notes tied to the card by a typed link or a mention in their text. */
  notes: number;
  /** Other cards tied to it the same way. */
  cards: number;
  /** Typed links that point at the card or start at it; a delete removes them. */
  links: number;
  /** Notes and cards that mention the card in their text; the text stays as written. */
  mentions: number;
}

/**
 * The warning before a card with connections is deleted: it says what the card is connected to,
 * that the links go with it and that mentions in text stay as text. "Undo" brings the links back.
 */
export function DeleteCardDialog({
  counts,
  onConfirm,
  onCancel,
}: {
  counts: ReferenceCounts;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t, tn, lang } = useI18n();
  const parts = [
    counts.notes > 0 ? tn("hl.confirm.notes", counts.notes) : null,
    counts.cards > 0 ? tn("hl.confirm.cards", counts.cards) : null,
    counts.links > 0 ? tn("hl.confirm.links", counts.links) : null,
  ].filter((part): part is string => part !== null);
  const what = new Intl.ListFormat(lang, { style: "long", type: "conjunction" }).format(parts);

  return (
    <AlertDialog.Root open onOpenChange={(open) => !open && onCancel()}>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="fixed inset-0 z-50 bg-ink/30" />
        <AlertDialog.Popup
          data-testid="delete-card-dialog"
          className="fixed left-1/2 top-1/3 z-50 w-[min(26rem,calc(100vw-2rem))] -translate-x-1/2 border border-line bg-surface p-4 text-ink"
        >
          <AlertDialog.Title className="text-[13px] font-semibold">
            {t("hl.confirm.title")}
          </AlertDialog.Title>
          <AlertDialog.Description className="mt-2 space-y-2 text-[12px]">
            <span className="block">{t("hl.confirm.connected", { what })}</span>
            {counts.links > 0 ? <span className="block">{t("hl.confirm.linksGo")}</span> : null}
            {counts.mentions > 0 ? (
              <span className="block">{t("hl.confirm.mentionsStay")}</span>
            ) : null}
          </AlertDialog.Description>
          <div className="mt-4 flex justify-end gap-2">
            <Button size="sm" onClick={onCancel}>
              {t("common.cancel")}
            </Button>
            <Button size="sm" variant="primary" onClick={onConfirm}>
              {t("hl.delete")}
            </Button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
