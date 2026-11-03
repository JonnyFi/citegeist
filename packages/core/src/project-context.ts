import {
  type NumberedNode,
  projectsContext,
  projectsEditReading,
  type ReadingOp,
  type ReadingSummary,
  type Registry,
} from "@citegeist/ops";
import { CitegeistError, type PlanTemplate, type ProjectFrontmatter } from "@citegeist/schema";

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

/** The reading list as agents see it: counts, the next item and the first entries. */
function summarize(list: Reading): ReadingSummary {
  const next = list.entries.find((e) => e.item.citekey === list.next)?.item;
  return {
    total: list.total,
    read: list.read,
    ...(next ? { next: { citekey: next.citekey, title: next.title } } : {}),
    entries: list.entries.slice(0, READING_ENTRIES).map((e) => ({
      citekey: e.item.citekey,
      title: e.item.title,
      status: e.item.status,
      ...(e.note ? { note: e.note } : {}),
    })),
  };
}

/**
 * Binds the two operations that compose others for agents. projects.context is the single read:
 * the projects of the library, or one project (brief, questions, settings), its reading list, its
 * plans and, when the plan is known, the outline. projects.editReading is the single write for
 * the reading list. Both call the operations they are made of, so the permissions and errors of
 * those operations stay the ones that apply.
 */
export function bindProjectContext<R extends Registry>(registry: R): R {
  registry.bind(projectsContext, async (ctx, input) => {
    const call: Call = (name, body) => registry.call(name, ctx, body);
    if (input.slug === undefined) {
      return (await call("projects.list", {})) as { projects: ProjectFrontmatter[] };
    }
    const project = (await call("projects.get", { slug: input.slug })) as {
      frontmatter: ProjectFrontmatter;
      brief: string;
      items: number;
    };
    const { plans } = (await call("plans.list", { project: input.slug })) as Plans;
    const list = (await call("projects.reading", { slug: input.slug })) as Reading;
    const result = {
      frontmatter: project.frontmatter,
      brief: project.brief,
      items: project.items,
      reading: summarize(list),
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

  registry.bind(projectsEditReading, async (ctx, input) => {
    const call: Call = (name, body) => registry.call(name, ctx, body);
    const slug = input.project;
    const current = (await call("projects.reading", { slug })) as Reading;
    // Check every operation against the list as it will stand, so that nothing changes when one fails.
    const onList = new Set(current.entries.map((e) => e.item.citekey));
    const fail = (op: ReadingOp, citekey: string, reason: string) =>
      new CitegeistError({
        code: "NOT_IN_READING_LIST",
        message: `${op.op} '${citekey}': ${reason}`,
        fix: "Use an item that is on the reading list (get_project shows it), or add it first with an add operation (an item in the inbox has to be accepted first). No operation of this call ran.",
        recovery: "fix-and-retry",
        context: { slug, citekey, op: op.op },
        sideEffects: "none",
      });
    // An add of an item that stands on the list already only moves it (when a position is given).
    const listed = new Set<ReadingOp>();
    for (const op of input.ops) {
      if (op.op === "add") {
        if (onList.has(op.item)) {
          listed.add(op);
          continue;
        }
        const got = (await call("items.get", { citekey: op.item })) as {
          frontmatter: { inbox?: unknown };
        };
        // An item that waits in the inbox joins the project but not the list.
        if (!got.frontmatter.inbox) onList.add(op.item);
        else if (op.note) {
          throw fail(op, op.item, "an item in the inbox is not on the reading list yet");
        }
      } else if (!onList.has(op.item)) {
        throw fail(op, op.item, `the item is not on the reading list of project '${slug}'`);
      }
    }
    const added: string[] = [];
    for (const op of input.ops) {
      if (op.op === "move") {
        await call("projects.moveReading", { slug, citekey: op.item, position: op.position });
      } else if (op.op === "note") {
        await call("projects.setReadingNote", { slug, citekey: op.item, note: op.note });
      } else {
        const out = (await call("projects.addItems", {
          slug,
          citekeys: [op.item],
          ...(op.position !== undefined ? { position: op.position } : {}),
        })) as { added: string[] };
        added.push(...out.added);
        if (listed.has(op) && op.position !== undefined) {
          await call("projects.moveReading", { slug, citekey: op.item, position: op.position });
        }
        if (op.note) {
          await call("projects.setReadingNote", { slug, citekey: op.item, note: op.note });
        }
      }
    }
    const list = (await call("projects.reading", { slug })) as Reading;
    return { project: slug, added, reading: summarize(list) };
  });
  return registry;
}
