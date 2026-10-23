import { notesGet } from "@citegeist/ops";
import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { ErrorState, Loading } from "../components/ui/states";
import { ConnectionsPanel } from "../connections";
import { type MessageKey, useI18n } from "../i18n";
import { useOp } from "../lib/hooks";
import { type Draft, type SaveState, useNoteAutosave } from "./autosave";
import { BacklinksPanel } from "./backlinks-panel";
import { EditorField } from "./editor-field";
import { useLibraryLinks } from "./library-links";

const STATE_KEY: Record<SaveState, MessageKey> = {
  saved: "notes.saved",
  dirty: "notes.unsaved",
  saving: "notes.saving",
  failed: "notes.saveFailed",
};

function NoteBody({ id, initial, type }: { id: string; initial: Draft; type: string }) {
  const { t, has } = useI18n();
  const { index, provider } = useLibraryLinks();
  const [draft, setDraft] = useState<Draft>(initial);
  const titleRef = useRef<HTMLInputElement>(null);

  const autosave = useNoteAutosave(id, initial, draft, { onExternal: setDraft });

  // A note that was just created is empty: put the cursor into the title so it can be named.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs once, when the note opens
  useEffect(() => {
    if (initial.body === "" && initial.title === t("notes.untitled")) {
      titleRef.current?.focus();
      titleRef.current?.select();
    }
  }, []);

  const typeKey = `notes.type.${type}`;
  return (
    <article className="mx-auto w-full max-w-3xl px-8 py-8">
      <input
        ref={titleRef}
        aria-label={t("notes.titleLabel")}
        value={draft.title}
        onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
        className="w-full bg-transparent font-serif text-3xl font-semibold tracking-tight outline-none placeholder:text-muted"
      />
      <div className="mt-2 mb-6 flex items-center gap-3 text-xs text-muted">
        <Badge tone="outline">{has(typeKey) ? t(typeKey as MessageKey) : type}</Badge>
        <span role="status" aria-live="polite" data-testid="save-state" data-state={autosave.state}>
          {autosave.state === "failed" ? (
            <span className="text-danger">
              {t(STATE_KEY.failed)}{" "}
              <Button size="sm" variant="outline" onClick={() => void autosave.retry()}>
                {t("notes.retry")}
              </Button>
            </span>
          ) : (
            t(STATE_KEY[autosave.state])
          )}
        </span>
      </div>
      <EditorField
        value={draft.body}
        onChange={(body) => setDraft((d) => ({ ...d, body }))}
        provider={provider}
        index={index}
        label={t("notes.bodyLabel")}
        placeholder={t("notes.bodyPlaceholder")}
      />
      <ConnectionsPanel kind="note" id={id} />
      <BacklinksPanel id={id} />
    </article>
  );
}

/** One note: title, live-preview editor with autosave, and the notes that link to it. */
export function NoteView({ id }: { id: string }) {
  const { t } = useI18n();
  const note = useOp(notesGet, { id });

  if (note.isPending) return <Loading label={t("notes.loading")} />;
  if (note.isError) return <ErrorState error={note.error} />;

  return (
    <NoteBodyLoaded
      key={id}
      id={id}
      title={note.data.frontmatter.title}
      body={note.data.body}
      type={note.data.frontmatter.type}
    />
  );
}

/** Keeps `initial` referentially stable so the autosave baseline only moves when the note does. */
function NoteBodyLoaded({
  id,
  title,
  body,
  type,
}: {
  id: string;
  title: string;
  body: string;
  type: string;
}) {
  const initial = useMemo(() => ({ title, body }), [title, body]);
  return <NoteBody id={id} initial={initial} type={type} />;
}
