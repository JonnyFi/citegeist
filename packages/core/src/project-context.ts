import { type NumberedNode, projectsContext, type Registry } from "@citegeist/ops";
import type { PlanTemplate, ProjectFrontmatter } from "@citegeist/schema";

type Call = (name: string, input: unknown) => Promise<unknown>;

interface Plans {
  plans: { plan: string; title: string; template?: PlanTemplate; nodes: number }[];
}

interface Outline {
  title: string;
  nodes: NumberedNode[];
}

/**
 * Binds projects.context, the single read for agents: the project (brief, questions, settings),
 * its plans and, when the plan is known, the outline. It composes projects.get, plans.list and
 * outline.get, so the permissions and errors of those operations stay the ones that apply.
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
    const result = {
      frontmatter: project.frontmatter,
      brief: project.brief,
      items: project.items,
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
