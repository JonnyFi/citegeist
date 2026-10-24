import { Menu } from "@base-ui/react/menu";
import { cardsExport } from "@citegeist/ops";
import { useEffect, useState } from "react";
import { useI18n } from "../i18n";
import { copyRich } from "../lib/clipboard";
import { useCore } from "../lib/hooks";
import { describeError } from "../lib/utils";

/**
 * "Exportieren" in the card column: copies every card as a direct or indirect citation, as HTML
 * and plain text together (cards.export). The result shows as "Kopiert" for a moment.
 */
export function CardExport({
  ids,
  project,
}: {
  ids: readonly string[];
  /** Citation style of this project, when the cards are shown for one. */
  project?: string | undefined;
}) {
  const { t, tn } = useI18n();
  const core = useCore();
  const [state, setState] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (state?.kind !== "ok") return;
    const timer = setTimeout(() => setState(null), 2500);
    return () => clearTimeout(timer);
  }, [state]);

  const copy = async (mode: "direct" | "indirect") => {
    const [first, ...rest] = ids;
    if (first === undefined) return;
    setState(null);
    try {
      const out = await core.call(cardsExport, {
        ids: [first, ...rest],
        mode,
        format: "html",
        ...(project ? { project } : {}),
      });
      await copyRich(out);
      setState({ kind: "ok", text: tn("cardExport.copied", ids.length) });
    } catch (err) {
      setState({ kind: "error", text: describeError(err).message });
    }
  };

  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span role="status" className={state?.kind === "error" ? "text-danger" : "text-muted"}>
        {state?.text ?? ""}
      </span>
      <Menu.Root>
        <Menu.Trigger
          disabled={ids.length === 0}
          className="text-muted underline-offset-2 hover:text-ink hover:underline disabled:opacity-50 data-[popup-open]:text-ink"
        >
          {t("cardExport.button")}
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner align="end" sideOffset={4} className="z-50">
            <Menu.Popup
              aria-label={t("cardExport.button")}
              className="min-w-52 border border-line bg-surface text-ink"
            >
              <Menu.Item
                onClick={() => void copy("direct")}
                className="flex h-8 cursor-default items-center px-2.5 text-[12px] data-[highlighted]:bg-ink data-[highlighted]:text-bg"
              >
                {t("cardExport.direct")}
              </Menu.Item>
              <Menu.Item
                onClick={() => void copy("indirect")}
                className="flex h-8 cursor-default items-center px-2.5 text-[12px] data-[highlighted]:bg-ink data-[highlighted]:text-bg"
              >
                {t("cardExport.indirect")}
              </Menu.Item>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    </div>
  );
}
