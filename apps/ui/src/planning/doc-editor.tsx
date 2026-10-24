import type { NumberedNode } from "@citegeist/ops";
import { planDocsGet, planDocsUpdate } from "@citegeist/ops";
import { useMemo, useState } from "react";
import { ErrorState, Loading } from "../components/ui/states";
import { useI18n } from "../i18n";
import { SaveStatus, useDocAutosave } from "../lib/autosave";
import { useCore, useOp } from "../lib/hooks";
import { EditorField } from "../notes/editor-field";
import { useLibraryLinks } from "../notes/library-links";
import { withNodeLinks } from "./node-links";

function DocBody({
  project,
  plan,
  doc,
  label,
  initial,
  nodes,
  hint,
  onOpenNode,
}: {
  project: string;
  plan: string;
  doc: string;
  label: string;
  initial: { body: string; hash: string };
  nodes: readonly NumberedNode[];
  hint?: string | undefined;
  onOpenNode: (id: string) => void;
}) {
  const { t } = useI18n();
  const links = useLibraryLinks();
  const core = useCore();
  const [draft, setDraft] = useState(initial.body);
  const save = useDocAutosave(
    (body, baseHash) => core.call(planDocsUpdate, { project, plan, doc, body, baseHash }),
    initial,
    draft,
    setDraft,
  );
  const provider = useMemo(
    () => withNodeLinks(links.provider, nodes, t("plan.linkDetail")),
    [links.provider, nodes, t],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-4">
      <div className="mb-3 flex items-center justify-between gap-3 text-[12px] text-muted">
        <span>{hint ?? ""}</span>
        <SaveStatus save={save} keepMine={t("plan.doc.keepMine")} />
      </div>
      <EditorField
        value={draft}
        onChange={setDraft}
        provider={provider}
        index={links.index}
        label={label}
        placeholder={t("plan.doc.placeholder")}
        onOpenTarget={(target) => {
          if (!nodes.some((n) => n.id === target)) return false;
          onOpenNode(target);
          return true;
        }}
      />
    </div>
  );
}

/** The text of the planning document or of a node document, in the notes editor, with autosave. */
export function DocEditor({
  project,
  plan,
  doc,
  label,
  nodes,
  hint,
  onOpenNode,
}: {
  project: string;
  plan: string;
  doc: string;
  label: string;
  nodes: readonly NumberedNode[];
  hint?: string | undefined;
  onOpenNode: (id: string) => void;
}) {
  const { t } = useI18n();
  const read = useOp(planDocsGet, { project, plan, doc });
  if (read.isPending) return <Loading label={t("plan.doc.loading")} />;
  if (read.isError) return <ErrorState error={read.error} />;
  return (
    <DocBody
      key={`${plan}/${doc}`}
      project={project}
      plan={plan}
      doc={doc}
      label={label}
      initial={{ body: read.data.body, hash: read.data.hash }}
      nodes={nodes}
      hint={hint ?? (read.data.exists ? read.data.path : t("plan.doc.noFile"))}
      onOpenNode={onOpenNode}
    />
  );
}
