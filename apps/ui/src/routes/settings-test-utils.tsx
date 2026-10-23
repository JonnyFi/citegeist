import { QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { createQueryClient, LanguageSync } from "../app";
import { I18nProvider } from "../i18n";
import { CoreProvider } from "../lib/hooks";
import { pollConfig } from "../onboarding/parts";
import {
  createSettingsMockCore,
  createSettingsMockState,
  type SettingsMockState,
} from "./settings-mock";

/** Renders `ui` inside the providers of the app, against a core that has only the settings operations. */
export function renderWithSettingsCore(ui: ReactNode, over: Partial<SettingsMockState> = {}) {
  pollConfig.ms = 5;
  const mock = createSettingsMockCore(createSettingsMockState(over));
  const view = render(
    <QueryClientProvider client={createQueryClient()}>
      <I18nProvider>
        <CoreProvider core={mock.core}>
          <LanguageSync />
          {ui}
        </CoreProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
  return { ...view, ...mock };
}
