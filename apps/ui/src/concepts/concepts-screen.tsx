import { conceptsCreate, conceptsList } from "@citegeist/ops";
import { Link, Outlet, useNavigate, useParams } from "@tanstack/react-router";
import { BookMarked, Plus } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { EmptyState, ErrorState, Loading } from "../components/ui/states";
import { useI18n } from "../i18n";
import { useOp, useOpMutation } from "../lib/hooks";
import { describeError } from "../lib/utils";
import { Proposals } from "./proposals";

function ConceptsList({ activeId }: { activeId: string | undefined }) {
  const { t, tn } = useI18n();
  const [filter, setFilter] = useState("");
  const query = filter.trim();
  const concepts = useOp(conceptsList, { limit: 500, ...(query ? { query } : {}) });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-3 pb-2">
        <Input
          type="search"
          aria-label={t("concepts.filterLabel")}
          placeholder={t("concepts.filterPlaceholder")}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {concepts.isPending ? (
          <Loading label={t("concepts.loadingList")} />
        ) : concepts.isError ? (
          <ErrorState error={concepts.error} />
        ) : concepts.data.concepts.length === 0 ? (
          <p className="px-2 py-4 text-muted">
            {query ? t("concepts.noMatch") : t("concepts.emptyTitle")}
          </p>
        ) : (
          <ul aria-label={t("concepts.listLabel")} className="flex flex-col gap-0.5">
            {concepts.data.concepts.map((concept) => (
              <li key={concept.id}>
                <Link
                  to="/concepts/$id"
                  params={{ id: concept.id }}
                  data-testid="concept-row"
                  aria-current={concept.id === activeId ? "page" : undefined}
                  className="block px-2.5 py-1.5 text-muted hover:bg-sunken hover:text-ink aria-[current=page]:bg-sunken aria-[current=page]:text-ink"
                >
                  <span className="block truncate aria-[current=page]:font-medium">
                    {concept.title}
                  </span>
                  <span className="flex flex-wrap gap-x-2 text-[11px] text-muted">
                    <span>{tn("concepts.sources", concept.sources)}</span>
                    <span>{tn("concepts.cards", concept.cards.length)}</span>
                    {concept.open > 0 ? (
                      <span>{t("concepts.open", { n: concept.open })}</span>
                    ) : null}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function CreateConcept({
  onDone,
  onMerged,
}: {
  onDone: (id: string) => void;
  onMerged: (title: string) => void;
}) {
  const { t } = useI18n();
  const create = useOpMutation(conceptsCreate);
  const [term, setTerm] = useState("");
  const [aliases, setAliases] = useState("");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const name = term.trim();
    if (!name) return;
    create.mutate(
      {
        term: name,
        aliases: aliases
          .split(",")
          .map((a) => a.trim())
          .filter(Boolean),
      },
      {
        onSuccess: (out) => {
          if (out.merged) onMerged(out.concept.title);
          onDone(out.concept.id);
        },
      },
    );
  };

  return (
    <form
      aria-label={t("concepts.create.title")}
      onSubmit={submit}
      className="flex max-w-[560px] flex-col gap-4 px-8 py-6"
    >
      <h2 className="font-serif text-[20px] font-medium leading-tight">
        {t("concepts.create.title")}
      </h2>
      <div className="flex flex-col gap-1">
        <label htmlFor="concept-term" className="text-[11px] text-muted">
          {t("concepts.create.term")}
        </label>
        <Input id="concept-term" value={term} onChange={(e) => setTerm(e.target.value)} autoFocus />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="concept-aliases" className="text-[11px] text-muted">
          {t("concepts.create.aliases")}
        </label>
        <Input id="concept-aliases" value={aliases} onChange={(e) => setAliases(e.target.value)} />
      </div>
      <p className="text-[12px] leading-[1.5] text-muted">{t("concepts.create.hint")}</p>
      {create.isError ? (
        <p role="alert" className="text-danger">
          {describeError(create.error, t("concepts.problem")).message}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={create.isPending || term.trim() === ""}>
          {t("concepts.create.submit")}
        </Button>
        <Button type="button" onClick={() => onDone("")}>
          {t("concepts.create.cancel")}
        </Button>
      </div>
    </form>
  );
}

type Panel = "none" | "create" | "propose";

/** Concepts: the list on the left, the open concept (the child route) or a panel on the right. */
export function ConceptsLayout() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { id } = useParams({ strict: false });
  const [panel, setPanel] = useState<Panel>("none");
  const [notice, setNotice] = useState<string>();

  const open = (conceptId: string) => {
    setPanel("none");
    if (conceptId) void navigate({ to: "/concepts/$id", params: { id: conceptId } });
  };

  return (
    <div className="flex h-full min-h-0">
      <section
        aria-label={t("concepts.title")}
        className="flex w-72 shrink-0 flex-col border-r border-line pt-4"
      >
        <div className="mb-3 flex items-center justify-between gap-2 px-3">
          <h1 className="font-serif text-lg font-semibold">{t("concepts.title")}</h1>
          <Button
            size="sm"
            variant="primary"
            onClick={() => {
              setNotice(undefined);
              setPanel("create");
            }}
          >
            <Plus className="size-3.5" />
            {t("concepts.new")}
          </Button>
        </div>
        <div className="mb-2 px-3">
          <Button
            size="sm"
            onClick={() => {
              setNotice(undefined);
              setPanel("propose");
            }}
          >
            {t("concepts.propose")}
          </Button>
        </div>
        {notice ? (
          <p role="status" className="mx-3 mb-2 text-[12px] leading-[1.5] text-muted">
            {notice}
          </p>
        ) : null}
        <ConceptsList activeId={id} />
      </section>
      <div className="min-w-0 flex-1 overflow-y-auto">
        {panel === "create" ? (
          <CreateConcept
            onDone={open}
            onMerged={(title) => setNotice(t("concepts.create.merged", { title }))}
          />
        ) : panel === "propose" ? (
          <Proposals onClose={() => setPanel("none")} onOpen={open} />
        ) : (
          <Outlet />
        )}
      </div>
    </div>
  );
}

/** Shown at /concepts while no concept is open. */
export function ConceptsIndex() {
  const { t } = useI18n();
  const all = useOp(conceptsList, { limit: 1 });
  const empty = all.data !== undefined && all.data.concepts.length === 0;
  return (
    <EmptyState
      icon={<BookMarked className="size-6" />}
      title={empty ? t("concepts.emptyTitle") : t("concepts.selectTitle")}
      description={empty ? t("concepts.emptyDescription") : t("concepts.selectDescription")}
    />
  );
}
