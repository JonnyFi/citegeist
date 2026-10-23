import { type ReactNode, useId } from "react";
import type { LanguageOption } from "./types.js";

export interface ReaderToolbarProps {
  /** Currently selected language of AI texts for this source (D9). Controlled. */
  language?: string | undefined;
  /** Options of the dropdown. Without options no dropdown is rendered. */
  languages?: LanguageOption[] | undefined;
  onLanguageChange?: ((value: string) => void) | undefined;
  /** Text of the dropdown label. */
  languageLabel?: string | undefined;
  /** Slot for the app: title, view switch, zoom. Rendered before the dropdown. */
  children?: ReactNode;
}

/**
 * Toolbar of the reader with the language dropdown slot (D9). The component holds no state: the
 * app owns the value and decides how the chain source, project, library default resolves.
 */
export function ReaderToolbar({
  language,
  languages,
  onLanguageChange,
  languageLabel = "AI language",
  children,
}: ReaderToolbarProps) {
  const id = useId();
  return (
    <div className="cg-toolbar" role="toolbar" aria-label="Reader">
      {children}
      <span className="cg-toolbar-spacer" />
      {languages && languages.length > 0 ? (
        <>
          <label htmlFor={id}>{languageLabel}</label>
          <select
            id={id}
            data-testid="reader-language"
            value={language ?? ""}
            onChange={(e) => onLanguageChange?.(e.target.value)}
          >
            {language === undefined || !languages.some((l) => l.value === language) ? (
              <option value="" disabled>
                -
              </option>
            ) : null}
            {languages.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
        </>
      ) : null}
    </div>
  );
}
