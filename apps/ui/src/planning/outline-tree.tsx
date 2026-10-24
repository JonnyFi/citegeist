import type { NumberedNode } from "@citegeist/ops";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Pencil, Plus, Trash2 } from "lucide-react";
import { type DragEvent, useEffect, useRef, useState } from "react";
import { Button } from "../components/ui/button";
import { useI18n } from "../i18n";
import { cn } from "../lib/utils";
import { type DropPlace, dropPlace, nextStatus, type Step } from "./outline";

export interface OutlineActions {
  select: (id: string) => void;
  rename: (id: string, title: string) => void;
  cycleStatus: (id: string) => void;
  step: (id: string, step: Step) => void;
  drop: (drag: string, target: string, place: DropPlace) => void;
  /** Adds a section below the node, or a chapter for `null`. */
  add: (parent: string | null) => void;
  remove: (id: string) => void;
}

/** The little four-step meter in front of a status: one filled square per step reached. */
export function StatusMeter({ status }: { status: NumberedNode["status"] }) {
  const reached = ["idea", "draft", "solid", "done"].indexOf(status) + 1;
  return (
    <span aria-hidden="true" className="inline-flex gap-px">
      {[1, 2, 3, 4].map((step) => (
        <span
          key={step}
          className={cn(
            "size-1.5 border border-ink",
            step <= reached ? "bg-ink" : "bg-transparent",
          )}
        />
      ))}
    </span>
  );
}

function RenameField({
  initial,
  onDone,
}: {
  initial: string;
  onDone: (title: string | null) => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <input
      ref={ref}
      aria-label={t("plan.node.rename")}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => onDone(draft.trim() && draft.trim() !== initial ? draft.trim() : null)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onDone(draft.trim() && draft.trim() !== initial ? draft.trim() : null);
        } else if (e.key === "Escape") {
          e.preventDefault();
          onDone(null);
        }
      }}
      className="h-6 min-w-0 flex-1 border-0 border-b border-line bg-transparent px-0 text-[13px]"
    />
  );
}

/**
 * The outline as a tree with computed numbers. Rows drag onto another row (top quarter: before,
 * middle: inside, bottom quarter: after). The same moves are on the buttons of the selected row,
 * so the order can be changed from the keyboard.
 */
export function OutlineTree({
  nodes,
  selected,
  actions,
}: {
  nodes: readonly NumberedNode[];
  selected: string | undefined;
  actions: OutlineActions;
}) {
  const { t } = useI18n();
  const [renaming, setRenaming] = useState<string | null>(null);
  const [over, setOver] = useState<{ id: string; place: DropPlace } | null>(null);
  const dragging = useRef<string | null>(null);

  const onDragOver = (e: DragEvent<HTMLElement>, id: string) => {
    if (!dragging.current || dragging.current === id) return;
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    setOver({ id, place: dropPlace(e.clientY - rect.top, rect.height) });
  };

  const onDrop = (e: DragEvent<HTMLElement>, id: string) => {
    e.preventDefault();
    const drag = dragging.current;
    dragging.current = null;
    const rect = e.currentTarget.getBoundingClientRect();
    const place = dropPlace(e.clientY - rect.top, rect.height);
    setOver(null);
    if (drag) actions.drop(drag, id, place);
  };

  return (
    <ol aria-label={t("plan.outline")} className="flex flex-col">
      {nodes.map((node, index) => {
        const on = node.id === selected;
        const siblingBefore = nodes
          .slice(0, index)
          .reverse()
          .find((n) => n.parent === node.parent);
        const siblingAfter = nodes.slice(index + 1).find((n) => n.parent === node.parent);
        const drop = over?.id === node.id ? over.place : null;
        return (
          <li
            key={node.id}
            data-testid="outline-node"
            data-node-id={node.id}
            data-number={node.number}
            draggable={renaming !== node.id}
            onDragStart={(e) => {
              dragging.current = node.id;
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", node.id);
            }}
            onDragEnd={() => {
              dragging.current = null;
              setOver(null);
            }}
            onDragOver={(e) => onDragOver(e, node.id)}
            onDragLeave={() => setOver((o) => (o?.id === node.id ? null : o))}
            onDrop={(e) => onDrop(e, node.id)}
            className={cn(
              "relative border-b border-line-soft",
              on ? "bg-sunken" : "hover:bg-sunken",
              drop === "before" && "shadow-[inset_0_2px_0_var(--ink)]",
              drop === "after" && "shadow-[inset_0_-2px_0_var(--ink)]",
              drop === "inside" && "outline outline-1 -outline-offset-1 outline-ink",
            )}
          >
            <div
              className="flex min-h-9 items-center gap-2 pr-2"
              style={{ paddingLeft: 12 + node.depth * 16 }}
            >
              <button
                type="button"
                aria-label={t("plan.node.statusCycle", {
                  status: t(`plan.status.${node.status}`),
                  next: t(`plan.status.${nextStatus(node.status)}`),
                })}
                title={t(`plan.status.${node.status}`)}
                onClick={() => actions.cycleStatus(node.id)}
                className="flex h-6 shrink-0 items-center px-0.5"
              >
                <StatusMeter status={node.status} />
              </button>
              {renaming === node.id ? (
                <RenameField
                  initial={node.title}
                  onDone={(title) => {
                    setRenaming(null);
                    if (title) actions.rename(node.id, title);
                  }}
                />
              ) : (
                <button
                  type="button"
                  aria-current={on ? "true" : undefined}
                  aria-label={`${node.number} ${node.title}`}
                  onClick={() => actions.select(node.id)}
                  onDoubleClick={() => setRenaming(node.id)}
                  onKeyDown={(e) => {
                    if (e.key === "F2") setRenaming(node.id);
                  }}
                  className={cn(
                    "flex min-h-9 min-w-0 flex-1 items-baseline gap-2 py-1.5 text-left",
                    on && "font-medium",
                  )}
                >
                  <span className="shrink-0 font-mono text-[12px] text-muted">{node.number}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{node.title}</span>
                    {node.purpose ? (
                      <span className="block truncate text-[11px] font-normal text-muted">
                        {node.purpose}
                      </span>
                    ) : null}
                  </span>
                </button>
              )}
            </div>
            {on && renaming !== node.id ? (
              <div
                role="toolbar"
                aria-label={t("plan.node.tools", { title: node.title })}
                className="flex items-center gap-px px-2 pb-1.5"
                style={{ paddingLeft: 12 + node.depth * 16 }}
              >
                <ToolButton
                  label={t("plan.node.up")}
                  disabled={!siblingBefore}
                  onClick={() => actions.step(node.id, "up")}
                  icon={<ArrowUp />}
                />
                <ToolButton
                  label={t("plan.node.down")}
                  disabled={!siblingAfter}
                  onClick={() => actions.step(node.id, "down")}
                  icon={<ArrowDown />}
                />
                <ToolButton
                  label={t("plan.node.indent")}
                  disabled={!siblingBefore}
                  onClick={() => actions.step(node.id, "indent")}
                  icon={<ChevronRight />}
                />
                <ToolButton
                  label={t("plan.node.outdent")}
                  disabled={node.parent === null}
                  onClick={() => actions.step(node.id, "outdent")}
                  icon={<ChevronLeft />}
                />
                <ToolButton
                  label={t("plan.node.rename")}
                  onClick={() => setRenaming(node.id)}
                  icon={<Pencil />}
                />
                <ToolButton
                  label={t("plan.node.addSection")}
                  onClick={() => actions.add(node.id)}
                  icon={<Plus />}
                />
                <ToolButton
                  label={t("plan.node.remove")}
                  onClick={() => actions.remove(node.id)}
                  icon={<Trash2 />}
                />
              </div>
            ) : null}
          </li>
        );
      })}
      <li className="px-3 py-2">
        <Button size="sm" onClick={() => actions.add(null)}>
          <Plus className="size-3.5" />
          {t("plan.node.addChapter")}
        </Button>
      </li>
    </ol>
  );
}

function ToolButton({
  label,
  icon,
  onClick,
  disabled,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="flex size-6 items-center justify-center text-ink hover:bg-bg disabled:opacity-30 [&>svg]:size-3.5"
    >
      {icon}
    </button>
  );
}
