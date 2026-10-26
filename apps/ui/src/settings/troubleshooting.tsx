import { useEffect, useState } from "react";
import type { AboutInfo } from "../bridge";
import { Button } from "../components/ui/button";
import { useI18n } from "../i18n";
import { Fact } from "./parts";

/**
 * Version, folders and the log file, with buttons to open the log and the bundled NOTICE. The
 * data comes from the main process of the desktop app; the browser preview has none.
 */
export function TroubleshootingPanel() {
  const { t } = useI18n();
  const about = window.citegeist?.about;
  const [info, setInfo] = useState<AboutInfo | null>(null);
  useEffect(() => {
    void about?.get().then(setInfo);
  }, [about]);
  if (!about || !info) return null;

  return (
    <div data-testid="troubleshooting" className="flex flex-col gap-3">
      <dl className="flex flex-col">
        <Fact label={t("settings.about.version")}>{info.version}</Fact>
        {info.commit ? (
          <Fact label={t("settings.about.commit")} mono>
            {info.commit}
          </Fact>
        ) : null}
        <Fact label={t("settings.about.license")}>{info.license}</Fact>
        <Fact label={t("settings.about.repository")} mono>
          <a href={info.repositoryUrl} target="_blank" rel="noreferrer" className="underline">
            {info.repositoryUrl}
          </a>
        </Fact>
        {info.libraryPath ? (
          <Fact label={t("settings.about.library")} mono>
            {info.libraryPath}
          </Fact>
        ) : null}
        <Fact label={t("settings.about.data")} mono>
          {info.dataDir}
        </Fact>
        <Fact label={t("settings.about.log")} mono>
          {info.logFile}
        </Fact>
      </dl>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void about.openLog()}>{t("settings.about.openLog")}</Button>
        <Button onClick={() => void about.revealLogFolder()}>
          {t("settings.about.revealLog")}
        </Button>
        {info.noticePath ? (
          <Button onClick={() => void about.openNotice()}>{t("settings.about.openNotice")}</Button>
        ) : null}
      </div>
    </div>
  );
}
