import { QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { createQueryClient, LanguageSync } from "../app";
import type { CoreConnection } from "../bridge";
import { I18nProvider, type Lang, useI18n } from "../i18n";
import { type Core, createRemoteCore } from "../lib/core";
import { CoreProvider } from "../lib/hooks";
import type { QuickInsertBridge } from "./bridge";
import { quickInsertText } from "./messages";
import { QuickInsertPalette } from "./palette";

function sameConnection(a: CoreConnection | null, b: CoreConnection | null): boolean {
  return a?.url === b?.url && a?.token === b?.token;
}

/**
 * Root of the palette window. It holds the core connection of the open library, and reads it again
 * on every show, because a library switch gives the core a new port and token.
 */
export function QuickInsertRoot({
  bridge,
  core: fixedCore,
  lang,
}: {
  bridge: QuickInsertBridge;
  /** A ready core instead of one built from the bridge connection (tests, browser preview). */
  core?: Core;
  lang?: Lang;
}) {
  const queryClient = useMemo(createQueryClient, []);
  const [connection, setConnection] = useState<CoreConnection | null>(() => bridge.connection());
  useEffect(
    () =>
      bridge.onShow(() =>
        setConnection((prev) => {
          const next = bridge.connection();
          return sameConnection(prev, next) ? prev : next;
        }),
      ),
    [bridge],
  );

  const core = useMemo(
    () => fixedCore ?? (connection ? createRemoteCore(connection) : null),
    [fixedCore, connection],
  );
  useEffect(() => (fixedCore ? undefined : () => core?.close()), [core, fixedCore]);

  return (
    <I18nProvider {...(lang ? { lang } : {})}>
      <QueryClientProvider client={queryClient}>
        {core ? (
          <CoreProvider core={core}>
            <LanguageSync />
            <QuickInsertPalette bridge={bridge} />
          </CoreProvider>
        ) : (
          <NoLibrary bridge={bridge} />
        )}
      </QueryClientProvider>
    </I18nProvider>
  );
}

function NoLibrary({ bridge }: { bridge: QuickInsertBridge }) {
  const { lang } = useI18n();
  const qi = quickInsertText(lang);
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Escape closes the palette also without a library
    <div
      className="flex h-full items-center justify-center rounded-xl border border-line bg-surface p-6 text-center text-muted shadow-2xl"
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === "Escape") bridge.close();
      }}
    >
      {qi("qi.noLibrary")}
    </div>
  );
}
