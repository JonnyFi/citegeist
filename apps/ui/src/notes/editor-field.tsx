import { NoteEditorView, type OpenLinkEvent, type WikiLinkProvider } from "@citegeist/editor";
import { useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import { type MessageKey, useI18n } from "../i18n";
import { type LinkIndex, resolveTarget } from "./library-links";

const LABEL_KEYS = {
  frontmatter: "editor.frontmatter",
  cardLoading: "editor.cardLoading",
  cardMissing: "editor.cardMissing",
  openCard: "editor.openCard",
  page: "editor.page",
  sectionItem: "editor.sectionItem",
  sectionNote: "editor.sectionNote",
  sectionCard: "editor.sectionCard",
} as const satisfies Record<string, MessageKey>;

/** Markdown editor wired to the library: autocomplete data, card embeds and opening links. */
export function EditorField({
  value,
  onChange,
  provider,
  index,
  label,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  provider: WikiLinkProvider | undefined;
  index: LinkIndex | undefined;
  label: string;
  placeholder: string;
}) {
  const { t, lang } = useI18n();
  const navigate = useNavigate();
  // biome-ignore lint/correctness/useExhaustiveDependencies: labels follow the language only
  const labels = useMemo(
    () =>
      Object.fromEntries(Object.entries(LABEL_KEYS).map(([k, key]) => [k, t(key)])) as Record<
        keyof typeof LABEL_KEYS,
        string
      >,
    [lang],
  );

  const open = (event: OpenLinkEvent) => {
    if (!index) return;
    const target = resolveTarget(index, event.target);
    if (!target) return;
    if (target.kind === "item") {
      void navigate({ to: "/items/$citekey", params: { citekey: target.citekey } });
    } else if (target.kind === "card") {
      void navigate({
        to: "/items/$citekey",
        params: { citekey: target.citekey },
        search: { tab: "read", card: target.id },
      });
    } else {
      void navigate({ to: "/notes/$id", params: { id: target.id } });
    }
  };

  return (
    <NoteEditorView
      value={value}
      onChange={onChange}
      {...(provider ? { provider } : {})}
      labels={labels}
      onOpenLink={open}
      ariaLabel={label}
      placeholder={placeholder}
      className="note-editor min-h-48"
    />
  );
}
