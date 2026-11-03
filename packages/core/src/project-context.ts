import { type NumberedNode, projectsContext, type Registry } from "@citegeist/ops";
import type { PlanTemplate, ProjectFrontmatter } from "@citegeist/schema";

type Call = (name: string, input: unknown) => Promise<unknown>;

interface Plans {
  plans: { plan: string; title: string; template?: PlanTemplate; nodes: number }[];
}

interface Reading {
  entries: { item: { citekey: string; title: string; status: string }; note?: string }[];
  total: number;
  read: number;
  next?: string;
}

/** Entries of the reading list that projects.context returns; projects.reading has all of them. */
const READING_ENTRIES = 50;

interface Outline {
  title: string;
  nodes: NumberedNode[];
}

/**
 * Binds projects.context, the single read for agents: the project (brief, questions, settings),
 * its plans and, when the plan is known, the outline. It composes projects.get, projects.reading,
 * plans.list and outline.get, so the permissions and errors of those operations stay the ones that apply.
 */
export function bindProjectContext<R extends Registry>(registry: R): R {
  registry.bind(projectsContext, async (ctx, input) => {
    const call: Call = (name, body) => registry.call(name, ctx, body);
    const project = (await call("projects.get", { slug: input.slug })) as {
      frontmatter: ProjectFrontmatter;
      brief: string;
      items: number;
    };
    const { plans } = (await call("plans.list", { project: input.slug })) as Plans;
    const list = (await call("projects.reading", { slug: input.slug })) as Reading;
    const next = list.entries.find((e) => e.item.citekey === list.next)?.item;
    const result = {
      frontmatter: project.frontmatter,
      brief: project.brief,
      items: project.items,
      reading: {
        total: list.total,
        read: list.read,
        ...(next ? { next: { citekey: next.citekey, title: next.title } } : {}),
        entries: list.entries.slice(0, READING_ENTRIES).map((e) => ({
          citekey: e.item.citekey,
          title: e.item.title,
          status: e.item.status,
          ...(e.note ? { note: e.note } : {}),
        })),
      },
      plans: plans.map(({ plan, title, template, nodes }) => ({
        plan,
        title,
        ...(template ? { template } : {}),
        nodes,
      })),
    };
    const wanted = input.plan ?? (plans.length === 1 ? plans[0]?.plan : undefined);
    if (!wanted) return result;
    const outline = (await call("outline.get", { project: input.slug, plan: wanted })) as Outline;
    return { ...result, outline: { plan: wanted, title: outline.title, nodes: outline.nodes } };
  });
  return registry;
}
