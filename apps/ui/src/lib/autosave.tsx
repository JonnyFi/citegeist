import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "../components/ui/button";
import { type MessageKey, useI18n } from "../i18n";
import { describeError } from "./utils";

export type SaveState = "saved" | "dirty" | "saving" | "failed";

const STATE_KEY: Record<SaveState, MessageKey> = {
  saved: "notes.saved",
  dirty: "notes.unsaved",
  saving: "notes.saving",
  failed: "notes.saveFailed",
};

/**
 * Saves a document shortly after the last edit. `write` gets the text and the hash of the version
 * the save builds on (the core refuses a save when the file changed in between). A change from
 * outside replaces the text while nothing is pending. Plan documents and texts share it.
 */
export function useDocAutosave(
  write: (body: string, baseHash: string) => Promise<{ hash: string }>,
  saved: { body: string; hash: string },
  draft: string,
  onExternal: (body: string) => void,
  delayMs = 800,
) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<SaveState>("saved");
  const [error, setError] = useState<string | null>(null);
  const confirmed = useRef({ body: saved.body, hash: saved.hash });
  const latest = useRef({ draft, write, saved });
  latest.current = { draft, write, saved };
  const running = useRef(false);
  const again = useRef(false);
  const alive = useRef(true);
  const onExt = useRef(onExternal);
  onExt.current = onExternal;

  const isDirty = useCallback(() => latest.current.draft !== confirmed.current.body, []);

  const flush = useCallback(
    async (options: { overwrite?: boolean } = {}) => {
      if (running.current) {
        again.current = true;
        return;
      }
      if (!isDirty()) return;
      running.current = true;
      if (alive.current) setState("saving");
      const { draft: body, write: save, saved: s } = latest.current;
      try {
        const out = await save(body, options.overwrite ? s.hash : confirmed.current.hash);
        confirmed.current = { body, hash: out.hash };
        setError(null);
        void queryClient.invalidateQueries({ queryKey: ["op"] });
        if (alive.current) setState("saved");
      } catch (err) {
        if (alive.current) {
          setError(describeError(err).message);
          setState("failed");
        }
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
    },
    [isDirty, queryClient],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the stored text changes
  useEffect(() => {
    if (running.current || isDirty()) return;
    if (saved.body !== confirmed.current.body || saved.hash !== confirmed.current.hash) {
      confirmed.current = { body: saved.body, hash: saved.hash };
      onExt.current(saved.body);
    }
  }, [saved.body, saved.hash]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the draft triggers the timer
  useEffect(() => {
    if (!isDirty()) {
      setState((s) => (s === "dirty" ? "saved" : s));
      return;
    }
    setState((s) => (s === "saving" || s === "failed" ? s : "dirty"));
    const timer = setTimeout(() => void flush(), delayMs);
    return () => clearTimeout(timer);
  }, [draft, delayMs, flush, isDirty]);

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

  return { state, error, flush };
}

/** "Gespeichert", "Speichert" and so on, with the way out of a refused save. */
export function SaveStatus({
  save,
  keepMine,
}: {
  save: ReturnType<typeof useDocAutosave>;
  /** Label of the button that saves over a file that changed in between. */
  keepMine: string;
}) {
  const { t } = useI18n();
  return (
    <span role="status" aria-live="polite" data-testid="save-state" data-state={save.state}>
      {save.state === "failed" ? (
        <span className="text-danger">
          {t("notes.saveFailed")}
          {save.error ? `: ${save.error}` : ""}{" "}
          <Button size="sm" onClick={() => void save.flush({ overwrite: true })}>
            {keepMine}
          </Button>
        </span>
      ) : (
        t(STATE_KEY[save.state])
      )}
    </span>
  );
}
