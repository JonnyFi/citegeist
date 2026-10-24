import { documentsAssets } from "@citegeist/ops";
import type { CellEvidence } from "@citegeist/schema";
import { Link, useNavigate } from "@tanstack/react-router";
import { useI18n } from "../i18n";
import { useCore } from "../lib/hooks";
import { saveReadingPosition } from "../lib/reading-position";

const CHIP =
  "shrink-0 border border-line-faint px-1.5 py-[1px] font-mono text-[11px] hover:bg-sunken";

/**
 * The passages a cell answer rests on. A card opens in the reader with the card selected. A
 * passage of the document opens the reader at its page: the page is looked up from the block and
 * stored as the reading position, which "resume" then picks up.
 */
export function Evidence({
  citekey,
  evidence,
}: {
  citekey: string;
  evidence: readonly CellEvidence[];
}) {
  const { t } = useI18n();
  const core = useCore();
  const navigate = useNavigate();

  if (evidence.length === 0) {
    return <p className="text-[11px] text-muted">{t("matrix.evidence.none")}</p>;
  }

  const openBlock = async (block: string) => {
    let resume = false;
    try {
      const assets = await core.call(documentsAssets, { citekey });
      const span = assets.blocks.find((b) => b.id === block)?.spans[0];
      if (span) {
        saveReadingPosition(citekey, {
          page: span.page,
          ...(span.label ? { label: span.label } : {}),
          ratio: 0,
          at: new Date().toISOString(),
        });
        resume = true;
      }
    } catch {
      // the reader opens without a position when the document cannot be read here
    }
    void navigate({
      to: "/items/$citekey",
      params: { citekey },
      search: { tab: "read", ...(resume ? { resume: true as const } : {}) },
    });
  };

  return (
    <ul aria-label={t("matrix.evidence.list")} className="flex flex-col gap-1">
      {evidence.map((e) => {
        const kind = e.type === "card" ? t("matrix.evidence.card") : t("matrix.evidence.block");
        const label = e.page ? `${kind} ${t("matrix.evidence.page", { page: e.page })}` : kind;
        const aria = t("matrix.evidence.open", { label });
        return (
          <li
            key={e.type === "card" ? e.card : `${e.block}-${e.quote.slice(0, 12)}`}
            data-testid="evidence"
            className="flex items-baseline gap-2"
          >
            {e.type === "card" ? (
              <Link
                to="/items/$citekey"
                params={{ citekey }}
                search={{ tab: "read", card: e.card }}
                aria-label={aria}
                title={e.quote}
                className={CHIP}
              >
                {label}
              </Link>
            ) : (
              <button
                type="button"
                aria-label={aria}
                title={e.quote}
                onClick={() => void openBlock(e.block)}
                className={CHIP}
              >
                {label}
              </button>
            )}
            <span className="line-clamp-1 min-w-0 font-serif text-[12px] italic text-muted">
              {e.quote}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
