import { Library } from "lucide-react";
import type { CitegeistBridge } from "../bridge";
import { useI18n } from "../i18n";
import { Button } from "./ui/button";
import { EmptyState } from "./ui/states";

/** Shown by the desktop app until a library folder is open. */
export function Welcome({ bridge }: { bridge: CitegeistBridge }) {
  const { t } = useI18n();
  return (
    <div className="drag-region flex h-full items-center justify-center">
      <EmptyState
        icon={<Library className="size-8" />}
        title={t("welcome.title")}
        description={t("welcome.description")}
        action={
          <div className="no-drag flex gap-2">
            <Button variant="primary" onClick={() => void bridge.openLibrary()}>
              {t("welcome.open")}
            </Button>
            <Button onClick={() => void bridge.createLibrary()}>{t("welcome.new")}</Button>
          </div>
        }
      />
    </div>
  );
}
