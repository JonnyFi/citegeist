/** Longest wait for the keys to come up. A lost keyup (focus change) must not hang the palette. */
export const MODIFIER_RELEASE_TIMEOUT_MS = 1500;

/** Whether Shift or Alt is down according to a keyboard or mouse event. */
export function shiftOrAltHeld(event: KeyboardEvent | MouseEvent): boolean {
  return (
    event.shiftKey ||
    event.altKey ||
    event.getModifierState("Shift") ||
    event.getModifierState("Alt")
  );
}

/**
 * Resolves once no modifier is held any more, or after `timeoutMs`.
 *
 * Why: the main process types Cmd+V into the other app right after the palette closes. A person
 * who chose with Shift+Enter or Alt+Enter still has that key down at that moment, and the target
 * app receives Cmd+Shift+V or Cmd+Alt+V instead of a plain paste. So the palette waits for the
 * keyup before it hands over.
 *
 * `isHeld` is called once without an event (the state when the choice was made) and again with
 * each keyup/keydown that reaches `target`, so it can read the modifier state of that event.
 */
export function waitForModifiersReleased(
  target: EventTarget,
  isHeld: (event?: KeyboardEvent) => boolean,
  timeoutMs: number = MODIFIER_RELEASE_TIMEOUT_MS,
): Promise<void> {
  if (!isHeld()) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      target.removeEventListener("keyup", onKey);
      target.removeEventListener("keydown", onKey);
      target.removeEventListener("blur", finish);
      resolve();
    };
    const onKey = (event: Event) => {
      if (!isHeld(event as KeyboardEvent)) finish();
    };
    const timer = setTimeout(finish, timeoutMs);
    target.addEventListener("keyup", onKey);
    target.addEventListener("keydown", onKey);
    target.addEventListener("blur", finish);
  });
}
