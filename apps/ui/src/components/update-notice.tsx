import { Download } from "lucide-react";
import { useEffect, useState } from "react";
import type { UpdateBridge, UpdateInfo } from "../bridge";
import { useI18n } from "../i18n";

/**
 * Top-bar notice that a newer release exists. The action opens Terminal on the install script, which
 * quits the app and replaces it (no signed updater without a Developer ID). Renders nothing where
 * the host offers no update bridge, such as the browser preview.
 */
export function UpdateNotice({ bridge }: { bridge?: UpdateBridge | undefined }) {
  const update = bridge ?? window.citegeist?.update;
  const { t } = useI18n();
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    if (!update) return;
    let live = true;
    // A push from the main process is newer than the answer to get(), which may arrive after it.
    let pushed = false;
    update
      .get()
      .then((found) => {
        if (live && !pushed) setInfo(found);
      })
      .catch(() => {});
    const off = update.onChange((found) => {
      pushed = true;
      if (live) setInfo(found);
    });
    return () => {
      live = false;
      off();
    };
  }, [update]);

  if (!update || !info) return null;
  return (
    <button
      type="button"
      data-testid="update-notice"
      title={started ? t("update.started") : t("update.hint", { version: info.version })}
      disabled={started}
      onClick={() => {
        setStarted(true);
        update.install().catch(() => setStarted(false));
      }}
      className="no-drag flex h-7 shrink-0 items-center gap-2 border border-line px-3 text-[12px] font-medium hover:bg-sunken disabled:opacity-60"
    >
      <Download className="size-3.5" aria-hidden="true" />
      <span>{started ? t("update.started") : t("update.available")}</span>
      <span className="font-mono text-muted">{info.version}</span>
    </button>
  );
}
