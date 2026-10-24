import { Registry } from "@citegeist/ops";
import { QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { createQueryClient, LanguageSync } from "../app";
import { I18nProvider } from "../i18n";
import { type Core, type CoreEvent, coreFromLink } from "../lib/core";
import { CoreProvider } from "../lib/hooks";
import { pollConfig } from "../onboarding/parts";
import { bindSettingsMock, createSettingsMockState } from "../routes/settings-mock";
import {
  bindSyncMock,
  bindWebhooksMock,
  createSyncMockState,
  createWebhooksMockState,
  type SyncMockState,
  type WebhooksMockState,
} from "./mock";

/**
 * Renders `ui` inside the providers of the app, against a core that has the settings, sync and
 * webhook operations. Every state can be overridden.
 */
export function renderWithPanelsCore(
  ui: ReactNode,
  over: { sync?: Partial<SyncMockState>; webhooks?: Partial<WebhooksMockState> } = {},
) {
  pollConfig.ms = 5;
  const settings = createSettingsMockState();
  const sync = createSyncMockState(over.sync);
  const webhooks = createWebhooksMockState(over.webhooks);
  const listeners = new Set<(e: CoreEvent) => void>();
  const emit = (e: CoreEvent) => {
    for (const l of listeners) l(e);
  };
  const registry = new Registry();
  bindSettingsMock(registry, settings, emit, false);
  bindSyncMock(registry, sync, emit);
  bindWebhooksMock(registry, webhooks, emit);
  const calls: Array<{ name: string; input: unknown }> = [];
  const core: Core = coreFromLink(
    {
      async call(path, input) {
        const name = path.join(".");
        calls.push({ name, input });
        return registry.call(name, { actor: "human" }, input);
      },
    },
    {
      label: "mock panels",
      isMock: false,
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
  );
  const view = render(
    <QueryClientProvider client={createQueryClient()}>
      <I18nProvider>
        <CoreProvider core={core}>
          <LanguageSync />
          {ui}
        </CoreProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
  return { ...view, calls, sync, webhooks, settings };
}
