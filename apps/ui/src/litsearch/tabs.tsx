import { useNavigate } from "@tanstack/react-router";
import { Segmented } from "../components/ui/segmented";
import { useI18n } from "../i18n";

/** "Runs | Preprints" in the sub bar of both lists. */
export function LitsearchTabs({ active }: { active: "runs" | "preprints" }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  return (
    <Segmented
      variant="tabs"
      label={t("litsearch.tabs")}
      value={active}
      onChange={(v) => void navigate({ to: v === "runs" ? "/litsearch" : "/litsearch/preprints" })}
      options={[
        { value: "runs", label: t("litsearch.runs") },
        { value: "preprints", label: t("litsearch.preprints") },
      ]}
    />
  );
}
