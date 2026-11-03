import { projectsMoveReading, projectsReading, projectsSetReadingNote } from "@citegeist/ops";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import type { z } from "zod";
import { useToast } from "../components/ui/toast";
import { useI18n } from "../i18n";
import { useCore, useOp } from "./hooks";
import { describeError } from "./utils";

export type ReadingList = z.output<typeof projectsReading.output>;

export type DropPlace = "before" | "after";

/** Upper half of a row drops before it, lower half after it. A row without height counts as after. */
export function dropPlace(offset: number, height: number): DropPlace {
  return height > 0 && offset / height < 0.5 ? "before" : "after";
}

/**
 * The position (0 is first) an item ends up at when it is dropped before or after another one:
 * the target's place in the list once the dragged item has left its old one.
 */
export function dropPosition(from: number, target: number, place: DropPlace): number {
  const slot = place === "before" ? target : target + 1;
  return from < slot ? slot - 1 : slot;
}

/**
 * The reading list of a project with the ways to change it. A change shows at once: the list the
 * core answers with replaces the cached one before the refetch of everything else arrives.
 */
export function useReadingList(slug: string) {
  const core = useCore();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { t, tn } = useI18n();
  const list = useOp(projectsReading, { slug });
  const [announcement, setAnnouncement] = useState("");
  /** The handle that has the focus after a move, because the row may be re-created. */
  const focus = useRef<string | undefined>(undefined);
  const entries = list.data?.entries;

  useEffect(() => {
    if (!focus.current || !entries) return;
    const key = focus.current;
    focus.current = undefined;
    for (const handle of document.querySelectorAll<HTMLElement>("[data-reading-handle]")) {
      if (handle.dataset.readingHandle === key) handle.focus();
    }
  }, [entries]);

  const keep = useCallback(
    (next: ReadingList) => {
      queryClient.setQueryData(["op", projectsReading.name, { slug }], next);
      void queryClient.invalidateQueries({ queryKey: ["op"] });
    },
    [queryClient, slug],
  );

  const move = useCallback(
    async (citekey: string, position: number, opts: { keepFocus?: boolean } = {}) => {
      const from = entries?.findIndex((e) => e.item.citekey === citekey) ?? -1;
      if (from < 0 || position === from || position < 0 || position >= (entries?.length ?? 0)) {
        return;
      }
      try {
        if (opts.keepFocus) focus.current = citekey;
        const next = await core.call(projectsMoveReading, { slug, citekey, position });
        keep(next);
        const title = entries?.[from]?.item.title ?? citekey;
        setAnnouncement(t("reading.moved", { title, position: position + 1, total: next.total }));
      } catch (err) {
        focus.current = undefined;
        toast.show({ message: t("reading.failed", { message: describeError(err).message }) });
      }
    },
    [core, entries, keep, slug, t, toast],
  );

  const setNote = useCallback(
    async (citekey: string, note: string) => {
      try {
        keep(await core.call(projectsSetReadingNote, { slug, citekey, note }));
      } catch (err) {
        toast.show({ message: t("reading.failed", { message: describeError(err).message }) });
      }
    },
    [core, keep, slug, t, toast],
  );

  const total = list.data?.total ?? 0;
  const read = list.data?.read ?? 0;
  return {
    list,
    move,
    setNote,
    announcement,
    progress: tn("reading.progress", total, { read }),
  };
}
