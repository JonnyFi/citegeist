import { inboxAccept, inboxReject, itemsMerge } from "@citegeist/ops";
import type { ItemFrontmatter } from "@citegeist/schema";
import { useNavigate } from "@tanstack/react-router";
import { useI18n } from "../i18n";
import { useOpMutation } from "../lib/hooks";
import { describeError } from "../lib/utils";
import { Button } from "./ui/button";
import { Star } from "./ui/provenance";

/**
 * The strip at the top of an inbox item: where the item is, who suggested it and why, with the two
 * decisions. "Annehmen" is the only way the item joins the library; the view then switches to the
 * library form in place, because the item query is refetched.
 */
export function InboxBanner({ fm }: { fm: ItemFrontmatter }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const accept = useOpMutation(inboxAccept);
  const reject = useOpMutation(inboxReject);
  const inbox = fm.inbox;
  if (!inbox) return null;
  const busy = accept.isPending || reject.isPending;
  const failure = accept.error ?? reject.error;
  return (
    <section
      aria-label={t("inboxItem.banner")}
      className="mb-3 flex flex-col gap-2 border border-line bg-sunken px-3 py-2 text-[13px]"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 text-muted">
          <Star />
          <span className="font-medium text-ink">{t("inboxItem.state")}</span>
          <span aria-hidden="true">·</span>
          <span>
            {t("inboxItem.by")}{" "}
            <span className="font-mono">{inbox.by === "human" ? t("actor.human") : inbox.by}</span>
          </span>
          {inbox.why ? (
            <>
              <span aria-hidden="true">·</span>
              <span className="min-w-0 text-ink">{inbox.why}</span>
            </>
          ) : null}
        </span>
        <span className="flex items-center gap-2">
          <Button
            size="sm"
            variant="primary"
            disabled={busy}
            onClick={() => accept.mutate({ citekeys: [fm.citekey] })}
          >
            {t("inbox.accept")}
          </Button>
          <Button
            size="sm"
            disabled={busy}
            onClick={() =>
              reject.mutate(
                { citekeys: [fm.citekey] },
                { onSuccess: () => void navigate({ to: "/inbox" }) },
              )
            }
          >
            {t("inbox.reject")}
          </Button>
        </span>
      </div>
      {failure ? (
        <p role="alert" className="text-[12px] text-danger">
          {t("inboxItem.failed", { message: describeError(failure).message })}
        </p>
      ) : null}
    </section>
  );
}

/** The two items of an offer to merge: the inbox item goes into the other one. */
export interface MergeOffer {
  from: string;
  into: string;
}

/** The offer inside an IDENTIFIER_IN_INBOX error, if that is what the error is. */
export function mergeOfferOf(err: unknown): MergeOffer | undefined {
  const described = describeError(err);
  if (described.code !== "IDENTIFIER_IN_INBOX") return undefined;
  const merge = described.context?.merge as Partial<MergeOffer> | undefined;
  return typeof merge?.from === "string" && typeof merge.into === "string"
    ? { from: merge.from, into: merge.into }
    : undefined;
}

/**
 * An identifier belongs to the same work on the other side of the inbox boundary. One click merges
 * the inbox item into the library item. When the open item is the inbox one, it is gone after the
 * merge and the view opens the library item.
 */
export function MergeOfferNote({
  citekey,
  offer,
  onMerged,
}: {
  /** The item that is open. */
  citekey: string;
  offer: MergeOffer;
  onMerged: (message: string) => void;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const merge = useOpMutation(itemsMerge);
  // the open item is the library one when the inbox item is the other
  const other = offer.from === citekey ? offer.into : offer.from;
  const intoOpen = offer.into === citekey;
  return (
    <div
      role="note"
      aria-label={t("inboxItem.banner")}
      className="flex flex-col gap-2 border border-line px-3 py-2 text-[13px]"
    >
      <span>
        {intoOpen
          ? t("inboxItem.mergeTextInbox", { citekey: other })
          : t("inboxItem.mergeTextLibrary", { citekey: other })}
      </span>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="primary"
          disabled={merge.isPending}
          onClick={() =>
            merge.mutate(offer, {
              onSuccess: (out) => {
                onMerged(
                  out.filled.length > 0
                    ? t("inboxItem.mergedFilled", {
                        citekey: other,
                        fields: out.filled.join(", "),
                      })
                    : t("inboxItem.merged", { citekey: other }),
                );
                if (!intoOpen) {
                  void navigate({ to: "/items/$citekey", params: { citekey: offer.into } });
                }
              },
            })
          }
        >
          {merge.isPending
            ? t("inboxItem.merging")
            : intoOpen
              ? t("inboxItem.mergeWithInbox", { citekey: other })
              : t("inboxItem.mergeWithLibrary", { citekey: other })}
        </Button>
      </div>
      {merge.error ? (
        <p role="alert" className="text-[12px] text-danger">
          {describeError(merge.error).message}
        </p>
      ) : null}
    </div>
  );
}
