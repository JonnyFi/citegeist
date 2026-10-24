import { itemsGet, RetractionMarker } from "@citegeist/ops";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { useEffect } from "react";
import { Label } from "../components/layout";
import { Stamp } from "../components/ui/badge";
import { type MessageKey, useI18n } from "../i18n";
import { useCore } from "../lib/hooks";
import { cn } from "../lib/utils";

/**
 * The retraction marker of an item is the frontmatter key `retraction`, written by
 * items.checkRetractions. Frontmatter passes unknown keys through, so the value arrives untyped.
 */
export function markerOf(raw: unknown): RetractionMarker | undefined {
  if (raw === undefined || raw === null) return undefined;
  const parsed = RetractionMarker.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

/** Retracted, withdrawn and expression of concern warn in danger; a correction is a note in ink. */
function isSevere(marker: RetractionMarker): boolean {
  return marker.status !== "corrected";
}

/** Link to the notice: the DOI of the first notice that has one. */
export function noticeUrl(marker: RetractionMarker): string | undefined {
  const doi = marker.notices.find((n) => n.doi)?.doi;
  return doi ? `https://doi.org/${doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")}` : undefined;
}

/**
 * Stamp with the status word. With the DOI of a notice it is a link to that notice; a click on the
 * badge in a table row opens the notice and does not open the item.
 */
export function RetractionBadge({
  marker,
  className,
}: {
  marker: RetractionMarker;
  className?: string;
}) {
  const { t } = useI18n();
  const status = t(`retraction.status.${marker.status}` as MessageKey);
  const url = noticeUrl(marker);
  const first = marker.notices[0];
  const title = [first?.label, first?.date].filter(Boolean).join(", ") || status;
  const stamp = (
    <Stamp tone={isSevere(marker) ? "danger" : "ink"} className={className}>
      {status}
    </Stamp>
  );
  if (!url) return <span title={title}>{stamp}</span>;
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      title={title}
      aria-label={t("retraction.badgeLabel", { status })}
      onClick={(e) => e.stopPropagation()}
      className="inline-flex"
    >
      {stamp}
    </a>
  );
}

/** Block on the source overview: what the notices say, where they come from, and the link. */
export function RetractionNote({ marker }: { marker: RetractionMarker }) {
  const { t } = useI18n();
  return (
    <section
      aria-label={t("retraction.title")}
      data-testid="retraction-note"
      className={cn(
        "flex flex-col gap-2 border px-3 py-2.5 text-[13px]",
        isSevere(marker) ? "border-danger" : "border-line",
      )}
    >
      <div className="flex items-center gap-2">
        <Stamp tone={isSevere(marker) ? "danger" : "ink"}>
          {t(`retraction.status.${marker.status}` as MessageKey)}
        </Stamp>
        <Label>{t("retraction.title")}</Label>
        <span className="ml-auto font-mono text-[11px] text-muted">
          {t("retraction.checked", { date: marker.checked })}
        </span>
      </div>
      <ul className="flex flex-col gap-1">
        {marker.notices.map((n) => (
          <li
            key={`${n.kind}-${n.doi ?? n.recordId ?? n.date ?? ""}`}
            className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5"
          >
            <span className="font-medium">
              {t(`retraction.kind.${n.kind}` as MessageKey)}
              {n.label ? `: ${n.label}` : ""}
            </span>
            {n.date ? <span className="font-mono text-[12px] text-muted">{n.date}</span> : null}
            <span className="text-[12px] text-muted">
              {t(`retraction.source.${n.source}` as MessageKey)}
            </span>
            {n.doi ? (
              <a
                href={`https://doi.org/${n.doi}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 underline"
              >
                {t("retraction.openNotice")}
                <ExternalLink className="size-3" />
              </a>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Markers for a list of items, for the table. items.list does not carry the marker, so each row
 * reads its item once; the result is kept for five minutes and refetched when the item's file
 * changes. The keys stay outside the ["op"] family so that unrelated library changes do not make
 * a whole table refetch.
 */
export function useRetractionMarkers(citekeys: readonly string[]): Map<string, RetractionMarker> {
  const core = useCore();
  const queryClient = useQueryClient();
  useEffect(
    () =>
      core.subscribe((event) => {
        const m = /^items\/([^/]+)\//.exec(event.path);
        if (m?.[1]) void queryClient.invalidateQueries({ queryKey: ["retraction", m[1]] });
      }),
    [core, queryClient],
  );
  const results = useQueries({
    queries: citekeys.map((citekey) => ({
      queryKey: ["retraction", citekey],
      staleTime: 5 * 60_000,
      queryFn: async () => {
        const out = await core.call(itemsGet, { citekey });
        return markerOf(out.frontmatter.retraction) ?? null;
      },
    })),
  });
  const out = new Map<string, RetractionMarker>();
  citekeys.forEach((citekey, i) => {
    const marker = results[i]?.data;
    if (marker) out.set(citekey, marker);
  });
  return out;
}
