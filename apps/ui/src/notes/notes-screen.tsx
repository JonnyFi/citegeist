import { notesList } from "@citegeist/editor/contracts";
import { notesCreate } from "@citegeist/ops";
import { Link, Outlet, useNavigate, useParams } from "@tanstack/react-router";
import { NotebookPen, Plus } from "lucide-react";
import { useState } from "react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { EmptyState, ErrorState, Loading } from "../components/ui/states";
import { useI18n } from "../i18n";
import { useOp, useOpMutation } from "../lib/hooks";
import { NoteView } from "./note-view";

function NotesList({ activeId }: { activeId: string | undefined }) {
  const { t } = useI18n();
  const [filter, setFilter] = useState("");
  const query = filter.trim();
  const notes = useOp(notesList, { limit: 500, ...(query ? { query } : {}) });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-3 pb-2">
        <Input
          type="search"
          aria-label={t("notes.filterLabel")}
          placeholder={t("notes.filterPlaceholder")}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {notes.isPending ? (
          <Loading label={t("notes.loadingList")} />
        ) : notes.isError ? (
          <ErrorState error={notes.error} />
        ) : notes.data.notes.length === 0 ? (
          <p className="px-2 py-4 text-muted">
            {query ? t("notes.noMatch") : t("notes.emptyTitle")}
          </p>
        ) : (
          <ul aria-label={t("notes.listLabel")} className="flex flex-col gap-0.5">
            {notes.data.notes.map((note) => (
              <li key={note.id}>
                <Link
                  to="/notes/$id"
                  params={{ id: note.id }}
                  data-testid="note-row"
                  aria-current={note.id === activeId ? "page" : undefined}
                  className="block truncate rounded-md px-2.5 py-1.5 text-muted hover:bg-sunken hover:text-ink aria-[current=page]:bg-sunken aria-[current=page]:font-medium aria-[current=page]:text-ink"
                >
                  {note.title}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function useCreateNote() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const create = useOpMutation(notesCreate);
  return async () => {
    const note = await create.mutateAsync({ title: t("notes.untitled"), type: "permanent" });
    void navigate({ to: "/notes/$id", params: { id: note.frontmatter.id } });
  };
}

/** Notes: the list on the left, the open note (the child route) on the right. */
export function NotesLayout() {
  const { t } = useI18n();
  const createNote = useCreateNote();
  const { id } = useParams({ strict: false });

  return (
    <div className="flex h-full min-h-0">
      <section
        aria-label={t("notes.title")}
        className="flex w-64 shrink-0 flex-col border-r border-line pt-4"
      >
        <div className="mb-3 flex items-center justify-between px-3">
          <h1 className="font-serif text-lg font-semibold">{t("notes.title")}</h1>
          <Button size="sm" variant="primary" onClick={() => void createNote()}>
            <Plus className="size-3.5" />
            {t("notes.new")}
          </Button>
        </div>
        <NotesList activeId={id} />
      </section>
      <div className="min-w-0 flex-1 overflow-y-auto">
        <Outlet />
      </div>
    </div>
  );
}

/** Shown at /notes while no note is open. */
export function NotesIndex() {
  const { t } = useI18n();
  const createNote = useCreateNote();
  const all = useOp(notesList, { limit: 1 });
  const empty = all.data !== undefined && all.data.notes.length === 0;

  return empty ? (
    <EmptyState
      icon={<NotebookPen className="size-6" />}
      title={t("notes.emptyTitle")}
      description={t("notes.emptyDescription")}
      action={
        <Button variant="primary" onClick={() => void createNote()}>
          {t("notes.new")}
        </Button>
      }
    />
  ) : (
    <EmptyState
      icon={<NotebookPen className="size-6" />}
      title={t("notes.selectTitle")}
      description={t("notes.selectDescription")}
    />
  );
}

export { NoteView };
