import {
  cardsList,
  citeFormat,
  itemsList,
  plansList,
  projectsGet,
  projectsList,
  projectsUpdate,
} from "@citegeist/ops";
import { Link } from "@tanstack/react-router";
import { FolderOpen, Pencil } from "lucide-react";
import { useState } from "react";
import { AlertsPanel } from "../alerts";
import { useI18n } from "../i18n";
import { AI_LANGUAGES, LIBRARY_AI_LANGUAGE } from "../lib/ai-language";
import { downloadText } from "../lib/clipboard";
import { useCore, useOp, useOpMutation } from "../lib/hooks";
import { cn, describeError } from "../lib/utils";
import { MatrixTab } from "../matrix";
import { type PlanSearch, PlanTab, type PlanView } from "../planning/plan-tab";
import { HeaderSlot, Label, RightColumn, SubBar } from "./layout";
import { ProjectCards } from "./project-cards";
import { ProjectReadingList } from "./project-list";
import { Prose } from "./prose";
import { StatusSquare } from "./ui/badge";
import { Button, ButtonGroup } from "./ui/button";
import { Textarea } from "./ui/input";
import { Segmented } from "./ui/segmented";
import { Select } from "./ui/select";
import { EmptyState, ErrorState, Loading } from "./ui/states";

export function ProjectsScreen() {
  const { t, tn } = useI18n();
  const projects = useOp(projectsList, {});
  return (
    <div className="mx-auto w-full max-w-5xl px-8 py-8">
      <h1 className="mb-6 font-serif text-[24px] font-medium leading-tight">{t("nav.projects")}</h1>
      {projects.isPending ? (
        <Loading label={t("projects.loading")} />
      ) : projects.isError ? (
        <ErrorState error={projects.error} />
      ) : projects.data.projects.length === 0 ? (
        <EmptyState
          icon={<FolderOpen />}
          title={t("projects.emptyTitle")}
          description={t("projects.emptyDescription")}
        />
      ) : (
        <ul className="grid gap-px border border-line bg-line sm:grid-cols-2">
          {projects.data.projects.map((p) => (
            <li key={p.slug} className="bg-bg">
              <Link
                to="/projects/$slug"
                params={{ slug: p.slug }}
                className="block h-full p-4 hover:bg-sunken"
              >
                <div className="flex items-center justify-between gap-2">
                  <h2 className="font-serif text-[20px] font-medium leading-tight">{p.title}</h2>
                  <span className="flex items-center gap-2 text-[12px]">
                    <StatusSquare filled={p.status === "active"} />
                    {t(`project.status.${p.status}`)}
                  </span>
                </div>
                <p className="mt-1 text-muted">
                  {p.questions.length === 0
                    ? t("projects.noQuestions")
                    : tn("projects.questions", p.questions.length)}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-2">
      <Label>{children}</Label>
    </h2>
  );
}

/** The project brief that agents read before every project task, in a bordered box with an inline editor. */
function BriefEditor({ slug, brief }: { slug: string; brief: string }) {
  const { t } = useI18n();
  const update = useOpMutation(projectsUpdate);
  const [draft, setDraft] = useState<string | null>(null);

  if (draft === null) {
    return (
      <>
        <div className="border border-line px-4 py-3.5">
          {brief.trim() ? (
            <Prose text={brief} size="card" />
          ) : (
            <p className="text-muted">{t("project.noBrief")}</p>
          )}
        </div>
        <Button size="sm" className="mt-3" onClick={() => setDraft(brief)}>
          <Pencil className="size-3.5" />
          {t("project.editBrief")}
        </Button>
      </>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        update.mutate({ slug, patch: {}, brief: draft }, { onSuccess: () => setDraft(null) });
      }}
    >
      <Textarea
        aria-label={t("project.briefLabel")}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={12}
        className="p-3 font-mono leading-relaxed"
      />
      <div className="mt-2 flex items-center gap-2">
        <Button type="submit" variant="primary" size="sm" disabled={update.isPending}>
          {t("common.save")}
        </Button>
        <Button type="button" size="sm" onClick={() => setDraft(null)}>
          {t("common.cancel")}
        </Button>
        {update.error ? (
          <span role="alert" className="text-danger">
            {describeError(update.error).message}
          </span>
        ) : null}
      </div>
    </form>
  );
}

/** Bibliography of the project as a BibTeX or CSL-JSON file, built by the core with cite.format. */
function ProjectExport({ slug, citekeys }: { slug: string; citekeys: readonly string[] }) {
  const { t } = useI18n();
  const core = useCore();
  const [state, setState] = useState<{ busy: boolean; error?: string }>({ busy: false });

  const run = async (format: "bibtex" | "csl-json") => {
    setState({ busy: true });
    try {
      const out = await core.call(citeFormat, {
        items: citekeys.map((citekey) => ({ citekey })),
        mode: "bibliography",
        format,
        project: slug,
      });
      if (format === "bibtex") downloadText(`${slug}.bib`, "application/x-bibtex", out.text);
      else downloadText(`${slug}.json`, "application/json", out.text);
      setState({ busy: false });
    } catch (err) {
      setState({ busy: false, error: describeError(err).message });
    }
  };

  return (
    <div className="flex items-center gap-2">
      {state.error ? (
        <span role="alert" className="text-danger">
          {state.error}
        </span>
      ) : null}
      <span className="text-[12px] text-muted">{t("project.export")}</span>
      <ButtonGroup>
        <Button
          size="sm"
          aria-label={t("project.exportBib")}
          disabled={state.busy || citekeys.length === 0}
          onClick={() => void run("bibtex")}
        >
          .bib
        </Button>
        <Button
          size="sm"
          aria-label={t("project.exportCsl")}
          disabled={state.busy || citekeys.length === 0}
          onClick={() => void run("csl-json")}
        >
          CSL-JSON
        </Button>
      </ButtonGroup>
    </div>
  );
}

const STATUSES = ["active", "paused", "done"] as const;

function ProjectTabLink({
  slug,
  tab,
  active,
  children,
}: {
  slug: string;
  tab?: ProjectTab;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      to="/projects/$slug"
      params={{ slug }}
      search={tab ? { tab } : {}}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center border-b-2",
        active ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink",
      )}
    >
      {children}
    </Link>
  );
}

export type ProjectTab = "brief" | "list" | "cards" | "plan" | "matrix";

/** The URL state of the project screen: the tab and, on the plan tab, the plan, node and view. */
export interface ProjectSearch extends PlanSearch {
  tab?: ProjectTab | undefined;
  /** The matrix open on the matrix tab. */
  matrix?: string | undefined;
}

const PLAN_VIEWS: readonly PlanView[] = ["doc", "insights", "gaps"];

export function parseProjectSearch(search: Record<string, unknown>): ProjectSearch {
  const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
  const tab =
    search.tab === "list" ||
    search.tab === "cards" ||
    search.tab === "plan" ||
    search.tab === "matrix"
      ? search.tab
      : undefined;
  const view = PLAN_VIEWS.find((v) => v === search.view);
  return {
    ...(tab ? { tab } : {}),
    ...(str(search.plan) ? { plan: str(search.plan) } : {}),
    ...(str(search.node) ? { node: str(search.node) } : {}),
    ...(str(search.matrix) ? { matrix: str(search.matrix) } : {}),
    ...(view && view !== "doc" ? { view } : {}),
  };
}

export function ProjectView({
  slug,
  search = {},
  onSearch,
}: {
  slug: string;
  search?: ProjectSearch;
  onSearch?: (next: ProjectSearch) => void;
}) {
  const { t, tn } = useI18n();
  const project = useOp(projectsGet, { slug });
  const items = useOp(itemsList, { project: slug, inbox: false, limit: 500 });
  const cards = useOp(cardsList, { project: slug, limit: 500 });
  const plans = useOp(plansList, { project: slug });
  const tab: ProjectTab = search.tab ?? "brief";
  const update = useOpMutation(projectsUpdate);

  if (project.isPending) return <Loading label={t("project.loading")} />;
  if (project.isError) return <ErrorState error={project.error} />;

  const { frontmatter: fm, brief } = project.data;
  const itemCount = project.data.items;

  const settings = (
    <dl className="flex flex-col overflow-y-auto">
      <div className="flex flex-col gap-1.5 border-b border-line-soft px-4 py-3.5">
        <dt className="text-[12px] text-muted">{t("project.statusLabel")}</dt>
        <dd>
          <Segmented
            label={t("project.statusLabel")}
            value={fm.status}
            onChange={(status) => update.mutate({ slug, patch: { status } })}
            options={STATUSES.map((s) => ({ value: s, label: t(`project.status.${s}`) }))}
          />
        </dd>
      </div>
      <div className="flex flex-col gap-1.5 border-b border-line-soft px-4 py-3.5">
        <dt className="text-[12px] text-muted">{t("project.aiLanguage")}</dt>
        <dd>
          <Select
            label={t("project.aiLanguage")}
            value={fm.ai_language ?? LIBRARY_AI_LANGUAGE}
            onChange={(v) => update.mutate({ slug, patch: { ai_language: v } })}
            options={AI_LANGUAGES.map((l) => ({ value: l, label: t(`aiLang.${l}`) }))}
            className="w-full"
          />
        </dd>
      </div>
      <div className="flex flex-col gap-1.5 border-b border-line-soft px-4 py-3.5">
        <dt className="text-[12px] text-muted">{t("project.citationStyle")}</dt>
        <dd className="font-mono text-[12px]">{fm.style}</dd>
      </div>
    </dl>
  );

  return (
    <div className="flex h-full min-h-0">
      <HeaderSlot>
        <nav
          aria-label={t("item.breadcrumb")}
          className="flex min-w-0 items-center gap-2 whitespace-nowrap text-muted"
        >
          <Link to="/projects" className="hover:text-ink">
            {t("nav.projects")}
          </Link>
          <span aria-hidden="true">/</span>
          <span className="truncate font-medium text-ink">{fm.title}</span>
        </nav>
        <span className="flex items-center gap-2 text-[12px] text-ink">
          <StatusSquare filled={fm.status === "active"} />
          {t(`project.status.${fm.status}`)}
        </span>
      </HeaderSlot>
      <div className="flex min-w-0 flex-1 flex-col">
        <SubBar>
          <div className="flex items-stretch gap-6 text-[13px] font-medium">
            <ProjectTabLink slug={slug} active={tab === "brief"}>
              {t("project.brief")}
            </ProjectTabLink>
            <ProjectTabLink slug={slug} tab="list" active={tab === "list"}>
              {t("project.readingList")}
              <span className="ml-1.5 font-mono font-normal">{itemCount}</span>
            </ProjectTabLink>
            <ProjectTabLink slug={slug} tab="cards" active={tab === "cards"}>
              {t("project.cardsTab")}
              {cards.data ? (
                <span className="ml-1.5 font-mono font-normal">{cards.data.cards.length}</span>
              ) : null}
            </ProjectTabLink>
            <ProjectTabLink slug={slug} tab="plan" active={tab === "plan"}>
              {t("project.planTab")}
              {plans.data ? (
                <span className="ml-1.5 font-mono font-normal">{plans.data.plans.length}</span>
              ) : null}
            </ProjectTabLink>
            <ProjectTabLink slug={slug} tab="matrix" active={tab === "matrix"}>
              {t("project.matrixTab")}
            </ProjectTabLink>
          </div>
          <div className="flex items-center">
            <ProjectExport slug={slug} citekeys={items.data?.items.map((i) => i.citekey) ?? []} />
          </div>
        </SubBar>
        {tab === "plan" ? (
          <PlanTab
            project={slug}
            questions={fm.questions}
            search={search}
            onSearch={(next) => onSearch?.({ ...next, tab: "plan" })}
          />
        ) : tab === "list" ? (
          <ProjectReadingList slug={slug} />
        ) : tab === "cards" ? (
          <ProjectCards slug={slug} />
        ) : tab === "matrix" ? (
          <MatrixTab
            project={slug}
            matrix={search.matrix}
            onMatrix={(matrix) => onSearch?.({ tab: "matrix", ...(matrix ? { matrix } : {}) })}
          />
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-10 pt-9">
            <div className="flex max-w-[680px] flex-col gap-7">
              <header className="flex flex-col gap-2">
                <h1 className="font-serif text-[30px] font-medium leading-[1.2] tracking-[-0.01em]">
                  {fm.title}
                </h1>
                <p className="text-muted">{tn("items.count", itemCount)}</p>
              </header>

              <section>
                <div className="flex items-center justify-between">
                  <SectionTitle>{t("project.brief")}</SectionTitle>
                  <span className="text-[11px] text-muted">{t("project.briefHint")}</span>
                </div>
                <BriefEditor slug={slug} brief={brief} />
              </section>

              {fm.questions.length > 0 ? (
                <section>
                  <SectionTitle>{t("project.questions")}</SectionTitle>
                  <ol className="flex flex-col border-t border-line">
                    {fm.questions.map((q) => (
                      <li
                        key={q.id}
                        className="grid grid-cols-[48px_minmax(0,1fr)] gap-3 border-b border-line-soft py-2.5 text-[14px]"
                      >
                        <span className="font-mono text-[12px] text-muted">
                          {t("project.questionShort", { n: q.id.replace(/^q/, "") })}
                        </span>
                        <span>{q.text}</span>
                      </li>
                    ))}
                  </ol>
                </section>
              ) : null}

              <section aria-labelledby="project-alerts">
                <div className="flex flex-col gap-1">
                  <h2 id="project-alerts" className="mb-0">
                    <Label>{t("alerts.title")}</Label>
                  </h2>
                  <p className="mb-2 text-[12px] text-muted">{t("alerts.descProject")}</p>
                </div>
                <AlertsPanel project={slug} />
              </section>

              {items.isError ? <ErrorState error={items.error} /> : null}
            </div>
          </div>
        )}
      </div>
      <RightColumn
        label={t("project.settingsTab")}
        tabs={[{ id: "settings", label: t("project.settingsTab"), content: settings }]}
      />
    </div>
  );
}
