import { citeFormat, itemsList, projectsGet, projectsList, projectsUpdate } from "@citegeist/ops";
import { Link } from "@tanstack/react-router";
import { Download, FolderOpen, Pencil } from "lucide-react";
import { useState } from "react";
import { useI18n } from "../i18n";
import { AI_LANGUAGES, LIBRARY_AI_LANGUAGE } from "../lib/ai-language";
import { downloadText } from "../lib/clipboard";
import { useCore, useOp, useOpMutation } from "../lib/hooks";
import { describeError } from "../lib/utils";
import { ItemsTable } from "./items-table";
import { Prose } from "./prose";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Select } from "./ui/select";
import { EmptyState, ErrorState, Loading } from "./ui/states";

export function ProjectsScreen() {
  const { t, tn } = useI18n();
  const projects = useOp(projectsList, {});
  return (
    <div className="mx-auto w-full max-w-5xl px-8 py-8">
      <h1 className="mb-6 font-serif text-2xl font-semibold">{t("nav.projects")}</h1>
      {projects.isPending ? (
        <Loading label={t("projects.loading")} />
      ) : projects.isError ? (
        <ErrorState error={projects.error} />
      ) : projects.data.projects.length === 0 ? (
        <EmptyState
          icon={<FolderOpen className="size-6" />}
          title={t("projects.emptyTitle")}
          description={t("projects.emptyDescription")}
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {projects.data.projects.map((p) => (
            <li key={p.slug}>
              <Link
                to="/projects/$slug"
                params={{ slug: p.slug }}
                className="block h-full border border-line bg-surface p-4 hover:border-accent"
              >
                <div className="flex items-center justify-between gap-2">
                  <h2 className="font-serif text-lg font-semibold">{p.title}</h2>
                  <Badge tone={p.status === "active" ? "accent" : "neutral"}>
                    {t(`project.status.${p.status}`)}
                  </Badge>
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
    <h2 className="mb-3 border-b border-line pb-1.5 text-xs font-medium uppercase tracking-wide text-muted">
      {children}
    </h2>
  );
}

/** The project brief that agents read before every project task, with an inline editor. */
function BriefEditor({ slug, brief }: { slug: string; brief: string }) {
  const { t } = useI18n();
  const update = useOpMutation(projectsUpdate);
  const [draft, setDraft] = useState<string | null>(null);

  if (draft === null) {
    return (
      <>
        {brief.trim() ? (
          <Prose text={brief} />
        ) : (
          <p className="text-muted">{t("project.noBrief")}</p>
        )}
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
      <textarea
        aria-label={t("project.briefLabel")}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={12}
        className="w-full border border-line bg-surface p-3 font-mono text-[13px] leading-relaxed"
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
    <div className="flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        disabled={state.busy || citekeys.length === 0}
        onClick={() => void run("bibtex")}
      >
        <Download className="size-3.5" />
        {t("project.exportBib")}
      </Button>
      <Button
        size="sm"
        disabled={state.busy || citekeys.length === 0}
        onClick={() => void run("csl-json")}
      >
        <Download className="size-3.5" />
        {t("project.exportCsl")}
      </Button>
      {state.error ? (
        <span role="alert" className="text-danger">
          {state.error}
        </span>
      ) : null}
    </div>
  );
}

export function ProjectView({ slug }: { slug: string }) {
  const { t, tn } = useI18n();
  const project = useOp(projectsGet, { slug });
  const items = useOp(itemsList, { project: slug, inbox: false, limit: 500 });
  const update = useOpMutation(projectsUpdate);

  if (project.isPending) return <Loading label={t("project.loading")} />;
  if (project.isError) return <ErrorState error={project.error} />;

  const { frontmatter: fm, brief } = project.data;
  return (
    <div className="mx-auto w-full max-w-4xl px-8 py-10">
      <header>
        <div className="mb-2 flex items-center gap-2">
          <Badge tone={fm.status === "active" ? "accent" : "neutral"}>
            {t(`project.status.${fm.status}`)}
          </Badge>
          <span className="text-muted">{tn("items.count", project.data.items)}</span>
        </div>
        <h1 className="font-serif text-3xl font-semibold">{fm.title}</h1>
        <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3">
          <Select
            label={t("project.aiLanguage")}
            value={fm.ai_language ?? LIBRARY_AI_LANGUAGE}
            onChange={(v) => update.mutate({ slug, patch: { ai_language: v } })}
            options={AI_LANGUAGES.map((l) => ({ value: l, label: t(`aiLang.${l}`) }))}
          />
          <ProjectExport slug={slug} citekeys={items.data?.items.map((i) => i.citekey) ?? []} />
        </div>
      </header>

      <section className="mt-8">
        <SectionTitle>{t("project.brief")}</SectionTitle>
        <BriefEditor slug={slug} brief={brief} />
      </section>

      {fm.questions.length > 0 ? (
        <section className="mt-8">
          <SectionTitle>{t("project.questions")}</SectionTitle>
          <ol className="flex flex-col gap-2 font-serif text-base">
            {fm.questions.map((q) => (
              <li key={q.id} className="flex gap-3">
                <span className="font-sans text-xs text-muted">{q.id.toUpperCase()}</span>
                {q.text}
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <section className="mt-8">
        <SectionTitle>{t("project.readingList")}</SectionTitle>
        {items.isPending ? (
          <Loading label={t("items.loading")} />
        ) : items.isError ? (
          <ErrorState error={items.error} />
        ) : items.data.items.length === 0 ? (
          <p className="text-muted">{t("project.noItems")}</p>
        ) : (
          <ItemsTable items={items.data.items} />
        )}
      </section>
    </div>
  );
}
