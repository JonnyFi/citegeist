import { cardsList } from "@citegeist/ops";
import { useState } from "react";
import { CardPanel } from "../components/card-panel";
import { ErrorState, Loading } from "../components/ui/states";
import { useI18n } from "../i18n";
import { useOp } from "../lib/hooks";

/**
 * The cards of the project next to the open text. A card opens with its two quote actions, which
 * insert the quotation and its citation at the cursor of the text (D20).
 */
export function ProjectCardColumn({ project, language }: { project: string; language: string }) {
  const { t } = useI18n();
  const cards = useOp(cardsList, { project, limit: 500 });
  const [selected, setSelected] = useState<string | undefined>(undefined);
  if (cards.isPending) return <Loading label={t("projectCards.loading")} />;
  if (cards.isError) return <ErrorState error={cards.error} />;
  return (
    <CardPanel
      cards={cards.data.cards}
      selectedId={selected}
      onSelect={setSelected}
      jobs={{}}
      onJob={() => undefined}
      defaultLanguage={language}
      orphaned={new Set()}
    />
  );
}
