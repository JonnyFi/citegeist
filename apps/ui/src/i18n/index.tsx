import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { de, type MessageKey } from "./de";
import { en } from "./en";

export type Lang = "de" | "en";
export const LANGS: readonly Lang[] = ["de", "en"];
export type { MessageKey };

/** Keys with a `.one` and a `.other` variant; `tn("items.count", 3)` picks by the number. */
export type PluralBase = MessageKey extends infer K
  ? K extends `${infer B}.one`
    ? B
    : never
  : never;

const CATALOGS: Record<Lang, Record<MessageKey, string>> = { de, en };
const STORAGE_KEY = "citegeist.lang";

export type Vars = Record<string, string | number>;

function fill(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole,
  );
}

export interface Translator {
  lang: Lang;
  t: (key: MessageKey, vars?: Vars) => string;
  /** Plural form by count. The count is also available as {n}. */
  tn: (base: PluralBase, n: number, vars?: Vars) => string;
  /** True when the catalog has this key; for keys built from data, such as item types. */
  has: (key: string) => key is MessageKey;
}

export interface I18n extends Translator {
  /** Switches the UI language. `persist` false applies it without remembering it as a user choice. */
  setLang: (lang: Lang, options?: { persist?: boolean }) => void;
  /** True once the user (or a test) chose a language, so settings must not override it. */
  explicit: boolean;
}

/** Translated text for a key built at runtime, or undefined when no such message exists. */
export function lookup(tr: Translator, key: string): string | undefined {
  return tr.has(key) ? tr.t(key) : undefined;
}

/** A translator for code outside React, such as tests and format helpers. */
export function translator(lang: Lang): Translator {
  const cat = CATALOGS[lang];
  const t = (key: MessageKey, vars?: Vars) => fill(cat[key], vars);
  return {
    lang,
    t,
    tn: (base, n, vars) => t(`${base}.${n === 1 ? "one" : "other"}` as MessageKey, { n, ...vars }),
    has: (key): key is MessageKey => key in cat,
  };
}

/**
 * The first language of a preference list that the UI offers: "de", "de-AT" and "de_DE" give
 * German, "en-GB" English. Other languages are skipped, so ["fr", "de"] gives German. Without a
 * match the UI is English.
 */
export function pickLang(preferred: readonly string[]): Lang {
  for (const tag of preferred) {
    const base = tag.toLowerCase().split(/[-_]/)[0];
    if (base === "de") return "de";
    if (base === "en") return "en";
  }
  return "en";
}

/** The language of the system, as the browser engine reports it (Electron follows macOS). */
export function systemLang(): Lang {
  const languages = typeof navigator === "undefined" ? [] : navigator.languages;
  const list = languages?.length
    ? languages
    : typeof navigator === "undefined"
      ? []
      : [navigator.language];
  return pickLang(list.filter((l): l is string => typeof l === "string"));
}

function storedLang(): Lang | undefined {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === "de" || v === "en" ? v : undefined;
  } catch {
    return undefined;
  }
}

const I18nContext = createContext<I18n | null>(null);

/**
 * The system language is the default, English when the system speaks neither German nor English.
 * A language passed in or stored from an earlier choice wins over it.
 */
export function I18nProvider({ lang: initial, children }: { lang?: Lang; children: ReactNode }) {
  const [state, setState] = useState<{ lang: Lang; explicit: boolean }>(() => {
    const chosen = initial ?? storedLang();
    return { lang: chosen ?? systemLang(), explicit: chosen !== undefined };
  });

  useEffect(() => {
    document.documentElement.lang = state.lang;
    // The desktop app's menus and dialogs follow the language the window shows.
    window.citegeist?.setLanguage?.(state.lang);
  }, [state.lang]);

  const setLang = useCallback((lang: Lang, options: { persist?: boolean } = {}) => {
    const persist = options.persist ?? true;
    if (persist) {
      try {
        localStorage.setItem(STORAGE_KEY, lang);
      } catch {
        // storage unavailable, the choice still applies for this session
      }
    }
    setState((prev) => ({ lang, explicit: prev.explicit || persist }));
  }, []);

  const value = useMemo<I18n>(
    () => ({ ...translator(state.lang), setLang, explicit: state.explicit }),
    [state, setLang],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/**
 * Without a provider (shared widgets rendered on their own, such as the settings and onboarding
 * screens, which bring their own language handling) the stored language applies, else the system's.
 */
export function useI18n(): I18n {
  const value = useContext(I18nContext);
  if (value) return value;
  return { ...translator(storedLang() ?? systemLang()), setLang: () => {}, explicit: false };
}
