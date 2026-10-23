import { notesUpdate } from "@citegeist/ops";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { useCore } from "../lib/hooks";

/** What the core does to a body on save, so the editor text and the saved text compare equal. */
export function normalizeBody(body: string): string {
  return body.replace(/^(?:[ \t]*\r?\n)+/, "").replace(/(?:\r?\n[ \t]*)+$/, "");
}

export type SaveState = "saved" | "dirty" | "saving" | "failed";

export interface Draft {
  title: string;
  body: string;
}

/**
 * Saves a note through notes.update shortly after the last edit. Edits made while a save is
 * running go out right after it. Pending changes are written when the note is closed or the
 * window loses focus, so leaving the screen never drops text.
 */
export function useNoteAutosave(
  id: string,
  saved: Draft,
  draft: Draft,
  options: { delayMs?: number; onExternal?: (note: Draft) => void } = {},
) {
  const core = useCore();
  const queryClient = useQueryClient();
  const delay = options.delayMs ?? 800;
  const [state, setState] = useState<SaveState>("saved");

  const latest = useRef({ draft, saved, id });
  latest.current = { draft, saved, id };
  const confirmed = useRef({ title: saved.title, body: normalizeBody(saved.body) });
  const running = useRef(false);
  const again = useRef(false);
  const alive = useRef(true);
  const onExternal = useRef(options.onExternal);
  onExternal.current = options.onExternal;

  const isDirty = useCallback(() => {
    const { draft: d } = latest.current;
    const c = confirmed.current;
    return (d.title.trim() !== "" && d.title !== c.title) || normalizeBody(d.body) !== c.body;
  }, []);

  const flush = useCallback(async () => {
    if (running.current) {
      again.current = true;
      return;
    }
    if (!isDirty()) return;
    running.current = true;
    if (alive.current) setState("saving");
    const { draft: d, id: noteId } = latest.current;
    const c = confirmed.current;
    try {
      const out = await core.call(notesUpdate, {
        id: noteId,
        ...(d.title.trim() !== "" && d.title !== c.title ? { title: d.title } : {}),
        ...(normalizeBody(d.body) !== c.body ? { body: d.body } : {}),
      });
      confirmed.current = { title: out.frontmatter.title, body: out.body };
      void queryClient.invalidateQueries({ queryKey: ["op"] });
      if (alive.current) setState("saved");
    } catch {
      if (alive.current) setState("failed");
      again.current = false;
      running.current = false;
      return;
    }
    running.current = false;
    if (again.current || isDirty()) {
      again.current = false;
      if (alive.current) setState("dirty");
      void flush();
    }
  }, [core, isDirty, queryClient]);

  // A change from outside (the file was edited elsewhere) replaces the text when nothing is pending.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the stored note changes
  useEffect(() => {
    if (running.current || isDirty()) return;
    const c = confirmed.current;
    if (c.title !== saved.title || c.body !== normalizeBody(saved.body)) {
      confirmed.current = { title: saved.title, body: normalizeBody(saved.body) };
      onExternal.current?.(saved);
    }
  }, [saved.title, saved.body]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the draft fields trigger the timer
  useEffect(() => {
    if (!isDirty()) {
      setState((s) => (s === "dirty" ? "saved" : s));
      return;
    }
    setState((s) => (s === "saving" ? s : "dirty"));
    const timer = setTimeout(() => void flush(), delay);
    return () => clearTimeout(timer);
  }, [draft.title, draft.body, delay, flush, isDirty]);

  useEffect(() => {
    const onBlur = () => void flush();
    window.addEventListener("blur", onBlur);
    return () => window.removeEventListener("blur", onBlur);
  }, [flush]);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      void flush();
    };
  }, [flush]);

  return { state, flush, retry: flush };
}
