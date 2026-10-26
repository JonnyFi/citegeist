import type { ChatContext, ChatSelection } from "@citegeist/ops";
import { useRouterState } from "@tanstack/react-router";
import { useSyncExternalStore } from "react";

/**
 * The passage the user marked in the reader. The reader publishes it, the chat shows it as a chip.
 * It lives outside React state so the reader and the chat panel need no shared parent.
 */
let current: ChatSelection | null = null;
const listeners = new Set<() => void>();

export function publishChatSelection(selection: ChatSelection | null): void {
  current = selection;
  for (const l of listeners) l();
}

export function useChatSelection(): ChatSelection | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
    () => null,
  );
}

/** Project and source from the open screen: `/projects/<slug>` and `/items/<citekey>`. */
export function contextFromPath(pathname: string): Pick<ChatContext, "project" | "item"> {
  const item = /^\/items\/([^/]+)/.exec(pathname)?.[1];
  const project = /^\/projects\/([^/]+)/.exec(pathname)?.[1];
  return {
    ...(item ? { item: decodeURIComponent(item) } : {}),
    ...(project ? { project: decodeURIComponent(project) } : {}),
  };
}

export function useScreenContext(): Pick<ChatContext, "project" | "item"> {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return contextFromPath(pathname);
}
