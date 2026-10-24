import {
  type NumberedNode,
  type OutlineOp,
  outlineApply,
  outlineGet,
  plansList,
} from "@citegeist/ops";
import { FileText, Lightbulb, ListTree, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Label } from "../components/layout";
import { Button } from "../components/ui/button";
import { Segmented } from "../components/ui/segmented";
import { EmptyState, ErrorState, Loading } from "../components/ui/states";
import { useI18n } from "../i18n";
import { useOp, useOpMutation } from "../lib/hooks";
import { cn, describeError } from "../lib/utils";
import { useLibraryLinks } from "../notes/library-links";
import { publishPlanContext } from "./context";
import { DocEditor } from "./doc-editor";
import { GapView } from "./gap-view";
import { InsightsView } from "./insights-view";
import { NewPlanForm } from "./new-plan";
import { NodeForm, type NodePatch } from "./node-form";
import { nextStatus, planMove, stepMove } from "./outline";
import { type OutlineActions, OutlineTree } from "./outline-tree";

export type PlanView = "doc" | "insights" | "gaps";

/** What the URL says about the plan screen. */
export interface PlanSearch {
  plan?: string | undefined;
  /** A node id, "plan" for the planning document or "project" for the project's insights. */
  node?: string | undefined;
  view?: PlanView | undefined;
}

interface Props {
  project: string;
  questions: ReadonlyArray<{ id: string; text: string }>;
  search: PlanSearch;
  onSearch: (next: PlanSearch) => void;
}

function Switcher({
  plans,
  current,
  creating,
  onPick,
  onNew,
}: {
  plans: ReadonlyArray<{ plan: string; title: string; nodes: number }>;
  current: string;
  creating: boolean;
  onPick: (slug: string) => void;
  onNew: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="flex h-11 shrink-0 items-center gap-3 border-b border-line-soft px-8">
      <Label>{t("plan.switcher")}</Label>
      <Segmented
        label={t("plan.switcher")}
        value={current}
        onChange={onPick}
        options={plans.map((p) => ({ value: p.plan, label: p.title }))}
      />
      <Button size="sm" aria-expanded={creating} onClick={onNew}>
        <Plus className="size-3.5" />
        {t("plan.new.button")}
      </Button>
    </div>
  );
}

function PlanBody({
  project,
  plan,
  planTitle,
  questions,
  search,
  onSearch,
}: Props & { plan: string; planTitle: string }) {
  const { t } = useI18n();
  const links = useLibraryLinks();
  const outline = useOp(outlineGet, { project, plan });
  const apply = useOpMutation(outlineApply);
  const [removal, setRemoval] = useState<{ id: string; message?: string } | null>(null);

  const nodes: readonly NumberedNode[] = useMemo(() => outline.data?.nodes ?? [], [outline.data]);
  const selected = search.node ?? "plan";
  const node = nodes.find((n) => n.id === selected);
  const view: PlanView = search.view ?? "doc";

  // an id that no longer exists (removed, or from another plan) falls back to the planning document
  useEffect(() => {
    if (outline.data && selected !== "plan" && selected !== "project" && !node) {
      onSearch({ ...search, node: undefined });
    }
  }, [outline.data, selected, node, onSearch, search]);

  // the chat panel tells the agent which plan and node are open
  useEffect(() => {
    publishPlanContext({
      project,
      plan,
      planTitle,
      ...(node ? { node: { id: node.id, number: node.number, title: node.title } } : {}),
    });
    return () => publishPlanContext(null);
  }, [project, plan, planTitle, node]);

  const run = (ops: OutlineOp[], then?: (added: string[]) => void, force = false) =>
    apply.mutate(
      { project, plan, ops, ...(force ? { force } : {}) },
      { onSuccess: (out) => then?.(out.added) },
    );

  const open = (id: string, nextView: PlanView = "doc") =>
    onSearch({ ...search, node: id, view: nextView });

  const actions: OutlineActions = {
    select: (id) => onSearch({ ...search, node: id, view: view === "gaps" ? "doc" : view }),
    rename: (id, title) => run([{ op: "update", id, title }]),
    cycleStatus: (id) => {
      const current = nodes.find((n) => n.id === id);
      if (current) run([{ op: "update", id, status: nextStatus(current.status) }]);
    },
    step: (id, step) => {
      const move = stepMove(nodes, id, step);
      if (move) run([{ op: "move", id, parent: move.parent, position: move.position }]);
    },
    drop: (drag, target, place) => {
      const move = planMove(nodes, drag, target, place);
      if (move) run([{ op: "move", id: drag, parent: move.parent, position: move.position }]);
    },
    add: (parent) =>
      run(
        [
          {
            op: "add",
            parent,
            title: parent === null ? t("plan.node.newChapter") : t("plan.node.newSection"),
          },
        ],
        ([id]) => {
          if (id) open(id);
        },
      ),
    remove: (id) => setRemoval({ id }),
  };

  const patch = (id: string, change: NodePatch) =>
    run([
      {
        op: "update",
        id,
        ...(change.title !== undefined ? { title: change.title } : {}),
        ...(change.purpose !== undefined ? { purpose: change.purpose } : {}),
        ...(change.status !== undefined ? { status: change.status } : {}),
        ...(change.questions !== undefined ? { questions: change.questions } : {}),
      },
    ]);

  const confirmRemoval = (force: boolean) => {
    if (!removal) return;
    apply.mutate(
      { project, plan, ops: [{ op: "remove", id: removal.id }], ...(force ? { force } : {}) },
      {
        onSuccess: () => {
          if (selected === removal.id) onSearch({ ...search, node: undefined });
          setRemoval(null);
        },
        onError: (err) => setRemoval({ id: removal.id, message: describeError(err).message }),
      },
    );
  };
  const removing = removal ? nodes.find((n) => n.id === removal.id) : undefined;

  const row = (on: boolean) =>
    cn(
      "flex h-9 w-full items-center gap-2 border-b border-line-soft px-3 text-left",
      on ? "bg-sunken font-medium" : "hover:bg-sunken",
    );

  const views = (
    <Segmented
      variant="tabs"
      label={t("plan.views")}
      value={view}
      onChange={(next) => onSearch({ ...search, view: next })}
      options={[
        { value: "doc", label: t("plan.view.doc") },
        { value: "insights", label: t("plan.view.insights") },
        { value: "gaps", label: t("plan.view.gaps") },
      ]}
    />
  );

  let content: React.ReactNode;
  if (outline.isPending) content = <Loading label={t("plan.loading")} />;
  else if (outline.isError) content = <ErrorState error={outline.error} />;
  else if (view === "insights" || selected === "project") {
    content = (
      <InsightsView
        project={project}
        plan={plan}
        nodes={nodes}
        index={links.index}
        selected={selected}
        onOpenNode={(id) => open(id)}
        onOpenPlan={(doc) =>
          onSearch({ ...search, node: doc, view: doc === "plan" ? "doc" : "insights" })
        }
      />
    );
  } else if (view === "gaps") {
    content = (
      <GapView
        project={project}
        plan={plan}
        nodes={nodes}
        index={links.index}
        onOpenNode={(id) => open(id)}
      />
    );
  } else if (node) {
    content = (
      <>
        <NodeForm
          key={node.id}
          node={node}
          questions={questions}
          onPatch={(change) => patch(node.id, change)}
        />
        <DocEditor
          project={project}
          plan={plan}
          doc={node.id}
          label={t("plan.doc.label", { title: node.title })}
          nodes={nodes}
          hint={node.doc ? undefined : t("plan.doc.noFile")}
          onOpenNode={(id) => open(id)}
        />
      </>
    );
  } else {
    content = (
      <>
        <div className="border-b border-line px-6 py-4">
          <h2 className="font-serif text-[22px] font-medium leading-tight">{t("plan.planDoc")}</h2>
          <p className="mt-1 text-[12px] text-muted">{t("plan.planDocHint")}</p>
        </div>
        <DocEditor
          project={project}
          plan={plan}
          doc="plan"
          label={t("plan.planDoc")}
          nodes={nodes}
          onOpenNode={(id) => open(id)}
        />
      </>
    );
  }

  return (
    <div className="flex min-h-0 flex-1">
      <nav
        aria-label={t("plan.navigation")}
        className="flex w-[280px] shrink-0 flex-col overflow-y-auto border-r border-line"
      >
        <button
          type="button"
          aria-current={selected === "plan" ? "true" : undefined}
          onClick={() => onSearch({ ...search, node: "plan", view: "doc" })}
          className={row(selected === "plan")}
        >
          <FileText className="size-4 shrink-0" />
          {t("plan.planDoc")}
        </button>
        {outline.data ? (
          nodes.length === 0 ? (
            <div className="border-b border-line-soft px-3 py-3 text-muted">
              <p>{t("plan.outlineEmpty")}</p>
              <Button size="sm" className="mt-2" onClick={() => actions.add(null)}>
                <Plus className="size-3.5" />
                {t("plan.node.addChapter")}
              </Button>
            </div>
          ) : (
            <OutlineTree nodes={nodes} selected={node?.id} actions={actions} />
          )
        ) : (
          <Loading label={t("plan.loading")} />
        )}
        {apply.error && !removal ? (
          <p role="alert" className="px-3 py-2 text-danger">
            {describeError(apply.error).message}
          </p>
        ) : null}
        {removing ? (
          <div
            role="alertdialog"
            aria-label={t("plan.remove.title")}
            className="m-3 border border-danger p-3"
          >
            <p className="font-medium">{t("plan.remove.ask", { title: removing.title })}</p>
            {removal?.message ? <p className="mt-1 text-danger">{removal.message}</p> : null}
            <div className="mt-2 flex gap-2">
              <Button
                size="sm"
                variant="primary"
                onClick={() => confirmRemoval(removal?.message !== undefined)}
              >
                {removal?.message !== undefined ? t("plan.remove.force") : t("plan.remove.confirm")}
              </Button>
              <Button size="sm" onClick={() => setRemoval(null)}>
                {t("common.cancel")}
              </Button>
            </div>
          </div>
        ) : null}
        <div className="flex-1" />
        <button
          type="button"
          aria-current={selected === "project" ? "true" : undefined}
          onClick={() => onSearch({ ...search, node: "project", view: "insights" })}
          className={cn(row(selected === "project"), "border-t border-line")}
        >
          <Lightbulb className="size-4 shrink-0" />
          {t("plan.projectInsights")}
        </button>
      </nav>
      <section aria-label={t("plan.content")} className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-9 shrink-0 items-stretch border-b border-line-soft px-6">
          {views}
        </div>
        {content}
      </section>
    </div>
  );
}

/** The planning tab of a project: plan switcher, outline, documents, insights and gaps. */
export function PlanTab({ project, questions, search, onSearch }: Props) {
  const { t } = useI18n();
  const plans = useOp(plansList, { project });
  const [creating, setCreating] = useState(false);

  if (plans.isPending) return <Loading label={t("plan.loading")} />;
  if (plans.isError) return <ErrorState error={plans.error} />;

  const list = plans.data.plans;
  const taken = list.map((p) => p.plan);
  if (list.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-8 py-8">
        <EmptyState
          icon={<ListTree />}
          title={t("plan.emptyTitle")}
          description={t("plan.emptyDescription")}
        />
        <div className="px-8">
          <NewPlanForm
            project={project}
            taken={taken}
            onCreated={(slug) => onSearch({ plan: slug })}
          />
        </div>
      </div>
    );
  }

  const current = list.find((p) => p.plan === search.plan) ?? list[0];
  if (!current) return null;
  const switchTo = (slug: string) => {
    setCreating(false);
    onSearch({ plan: slug });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Switcher
        plans={list}
        current={current.plan}
        creating={creating}
        onPick={switchTo}
        onNew={() => setCreating((c) => !c)}
      />
      {creating ? (
        <div className="overflow-y-auto px-8 py-6">
          <NewPlanForm
            project={project}
            taken={taken}
            onCreated={(slug) => {
              setCreating(false);
              onSearch({ plan: slug });
            }}
            onCancel={() => setCreating(false)}
          />
        </div>
      ) : (
        <PlanBody
          key={current.plan}
          project={project}
          plan={current.plan}
          planTitle={current.title}
          questions={questions}
          search={search}
          onSearch={onSearch}
        />
      )}
    </div>
  );
}
