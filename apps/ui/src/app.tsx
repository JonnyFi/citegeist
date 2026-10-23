import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { RouterHistory } from "@tanstack/react-router";
import { RouterProvider } from "@tanstack/react-router";
import { useMemo } from "react";
import type { CitegeistBridge } from "./bridge";
import { Welcome } from "./components/welcome";
import type { Core } from "./lib/core";
import { CoreProvider } from "./lib/hooks";
import { createAppRouter } from "./routes";

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 5_000, refetchOnWindowFocus: false } },
  });
}

/** Root of the renderer. Without a core (desktop app, no library open yet) it shows the welcome screen. */
export function App({
  core,
  bridge,
  history,
}: {
  core: Core | null;
  bridge?: CitegeistBridge | undefined;
  history?: RouterHistory;
}) {
  const queryClient = useMemo(createQueryClient, []);
  const router = useMemo(() => createAppRouter(history), [history]);

  if (!core) return bridge ? <Welcome bridge={bridge} /> : null;
  return (
    <QueryClientProvider client={queryClient}>
      <CoreProvider core={core}>
        <RouterProvider router={router} />
      </CoreProvider>
    </QueryClientProvider>
  );
}
