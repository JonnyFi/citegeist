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

/**
 * A card the user sent to the agent from the card menu. It becomes the marked passage (with the
 * card id, so the agent can pass it to the link tool) and asks the chat to take the focus.
 */
let focusRequested = false;
const focusListeners = new Set<() => void>();

export function sendCardToChat(selection: ChatSelection & { card: string }): void {
  focusRequested = true;
  publishChatSelection(selection);
  for (const l of focusListeners) l();
}

/** True once after a card was sent; the chat calls `clearChatFocusRequest` when it took the focus. */
export function useChatFocusRequest(): boolean {
  return useSyncExternalStore(
    (cb) => {
      focusListeners.add(cb);
      return () => focusListeners.delete(cb);
    },
    () => focusRequested,
    () => false,
  );
}

export function clearChatFocusRequest(): void {
  focusRequested = false;
  for (const l of focusListeners) l();
}
