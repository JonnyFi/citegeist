import type { ChatContext, ChatSelection } from "@citegeist/ops";
import { useRouterState } from "@tanstack/react-router";
import { useSyncExternalStore } from "react";

/**
 * The marked passage as the UI holds it. `locator` names where a card sits in its source, with
 * the label the chip needs ("page", "paragraph"); the core only receives `page`.
 */
export type MarkedPassage = ChatSelection & {
  locator?: { label: string; start: string; end?: string | undefined };
};

/** The selection as the core takes it: no locator, and `page` only for a real printed page. */
export function selectionForCore(marked: MarkedPassage): ChatSelection {
  const { locator, ...rest } = marked;
  if (locator && locator.label !== "page") {
    const { page: _page, ...withoutPage } = rest;
    return withoutPage;
  }
  return rest;
}

/**
 * The passage the user marked in the reader. The reader publishes it, the chat shows it as a chip.
 * It lives outside React state so the reader and the chat panel need no shared parent.
 */
let current: MarkedPassage | null = null;
const listeners = new Set<() => void>();

export function publishChatSelection(selection: MarkedPassage | null): void {
  current = selection;
  for (const l of listeners) l();
}

export function useChatSelection(): MarkedPassage | null {
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

export function sendCardToChat(selection: MarkedPassage & { card: string }): void {
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
