import { itemsList, projectsGet, projectsList } from "@citegeist/ops";
import { Link } from "@tanstack/react-router";
import { FolderOpen } from "lucide-react";
import { useOp } from "../lib/hooks";
import { ItemsTable } from "./items-table";
import { Prose } from "./prose";
import { Badge } from "./ui/badge";
import { EmptyState, ErrorState, Loading } from "./ui/states";

export function ProjectsScreen() {
  const projects = useOp(projectsList, {});
  return (
    <div className="mx-auto w-full max-w-5xl px-8 py-8">
      <h1 className="mb-6 font-serif text-2xl font-semibold">Projects</h1>
      {projects.isPending ? (
        <Loading label="Loading projects" />
      ) : projects.isError ? (
        <ErrorState error={projects.error} />
      ) : projects.data.projects.length === 0 ? (
        <EmptyState
          icon={<FolderOpen className="size-6" />}
          title="No projects yet"
          description="A project bundles papers, notes and a brief that agents read before they work for you."
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {projects.data.projects.map((p) => (
            <li key={p.slug}>
              <Link
                to="/projects/$slug"
                params={{ slug: p.slug }}
                className="block h-full rounded-lg border border-line bg-surface p-4 hover:border-accent"
              >
                <div className="flex items-center justify-between gap-2">
                  <h2 className="font-serif text-lg font-semibold">{p.title}</h2>
                  <Badge tone={p.status === "active" ? "accent" : "neutral"}>{p.status}</Badge>
                </div>
                <p className="mt-1 text-muted">
                  {p.questions.length === 0
                    ? "No research questions yet"
                    : `${p.questions.length} research ${p.questions.length === 1 ? "question" : "questions"}`}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ProjectView({ slug }: { slug: string }) {
  const project = useOp(projectsGet, { slug });
  const items = useOp(itemsList, { project: slug, inbox: false, limit: 200 });

  if (project.isPending) return <Loading label="Loading project" />;
  if (project.isError) return <ErrorState error={project.error} />;

  const { frontmatter: fm, brief } = project.data;
  return (
    <div className="mx-auto w-full max-w-4xl px-8 py-10">
      <header>
        <div className="mb-2 flex items-center gap-2">
          <Badge tone={fm.status === "active" ? "accent" : "neutral"}>{fm.status}</Badge>
          <span className="text-muted">
            {project.data.items} {project.data.items === 1 ? "item" : "items"}
          </span>
        </div>
        <h1 className="font-serif text-3xl font-semibold">{fm.title}</h1>
      </header>

      <section className="mt-8">
        <h2 className="mb-3 border-b border-line pb-1.5 text-xs font-medium uppercase tracking-wide text-muted">
          Brief
        </h2>
        {brief.trim() ? (
          <Prose text={brief} />
        ) : (
          <p className="text-muted">This project has no brief yet.</p>
        )}
      </section>

      {fm.questions.length > 0 ? (
        <section className="mt-8">
          <h2 className="mb-3 border-b border-line pb-1.5 text-xs font-medium uppercase tracking-wide text-muted">
            Research questions
          </h2>
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
        <h2 className="mb-3 border-b border-line pb-1.5 text-xs font-medium uppercase tracking-wide text-muted">
          Reading list
        </h2>
        {items.isPending ? (
          <Loading label="Loading items" />
        ) : items.isError ? (
          <ErrorState error={items.error} />
        ) : items.data.items.length === 0 ? (
          <p className="text-muted">No items in this project yet.</p>
        ) : (
          <ItemsTable items={items.data.items} />
        )}
      </section>
    </div>
  );
}
