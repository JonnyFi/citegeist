import { settingsGet } from "@citegeist/ops";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { RouterHistory } from "@tanstack/react-router";
import { RouterProvider } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import type { CitegeistBridge } from "./bridge";
import { Welcome } from "./components/welcome";
import { I18nProvider, type Lang, useI18n } from "./i18n";
import type { Core } from "./lib/core";
import { CoreProvider, useCore } from "./lib/hooks";
import { FirstRun, OnboardingGate } from "./onboarding";
import { createAppRouter } from "./routes";

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 5_000, refetchOnWindowFocus: false } },
  });
}

/**
 * Follows the UI language from the core's settings until the user picks one here. The mock core
 * has no settings, so the call fails and the default stays.
 */
export function LanguageSync() {
  const core = useCore();
  const { explicit, setLang } = useI18n();
  useEffect(() => {
    if (explicit) return;
    core
      .call(settingsGet, {})
      .then((out) => setLang(out.settings.uiLanguage, { persist: false }))
      .catch(() => {});
  }, [core, explicit, setLang]);
  return null;
}

/** Root of the renderer. Without a core (desktop app, no library open yet) it shows the welcome screen. */
export function App({
  core,
  bridge,
  history,
  lang,
}: {
  core: Core | null;
  bridge?: CitegeistBridge | undefined;
  history?: RouterHistory;
  /** Initial UI language; without it the stored choice, else German. */
  lang?: Lang;
}) {
  const queryClient = useMemo(createQueryClient, []);
  const router = useMemo(() => createAppRouter(history), [history]);

  return (
    <I18nProvider {...(lang ? { lang } : {})}>
      {!core ? (
        bridge ? (
          <FirstRun bridge={bridge} fallback={<Welcome bridge={bridge} />} />
        ) : null
      ) : (
        <QueryClientProvider client={queryClient}>
          <CoreProvider core={core}>
            <LanguageSync />
            <OnboardingGate>
              <RouterProvider router={router} />
            </OnboardingGate>
          </CoreProvider>
        </QueryClientProvider>
      )}
    </I18nProvider>
  );
}
