import type { NumberedNode } from "@citegeist/ops";
import { planDocsUpdate } from "@citegeist/ops";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../components/ui/button";
import { ErrorState, Loading } from "../components/ui/states";
import { type MessageKey, useI18n } from "../i18n";
import { useCore, useOp } from "../lib/hooks";
import { describeError } from "../lib/utils";
import { EditorField } from "../notes/editor-field";
import { useLibraryLinks } from "../notes/library-links";
import { planDocsGet } from "./contracts";
import { withNodeLinks } from "./node-links";

type SaveState = "saved" | "dirty" | "saving" | "failed";

const STATE_KEY: Record<SaveState, MessageKey> = {
  saved: "notes.saved",
  dirty: "notes.unsaved",
  saving: "notes.saving",
  failed: "notes.saveFailed",
};

/**
 * Saves a plan document through plan.docs.update shortly after the last edit, with the hash of the
 * version that was read. A change from outside replaces the text while nothing is pending.
 */
function useDocAutosave(
  target: { project: string; plan: string; doc: string },
  saved: { body: string; hash: string },
  draft: string,
  onExternal: (body: string) => void,
  delayMs = 800,
) {
  const core = useCore();
  const queryClient = useQueryClient();
  const [state, setState] = useState<SaveState>("saved");
  const [error, setError] = useState<string | null>(null);
  const confirmed = useRef({ body: saved.body, hash: saved.hash });
  const latest = useRef({ draft, target, saved });
  latest.current = { draft, target, saved };
  const running = useRef(false);
  const again = useRef(false);
  const alive = useRef(true);
  const onExt = useRef(onExternal);
  onExt.current = onExternal;

  const isDirty = useCallback(() => latest.current.draft !== confirmed.current.body, []);

  const flush = useCallback(
    async (options: { overwrite?: boolean } = {}) => {
      if (running.current) {
        again.current = true;
        return;
      }
      if (!isDirty()) return;
      running.current = true;
      if (alive.current) setState("saving");
      const { draft: body, target: t, saved: s } = latest.current;
      try {
        const out = await core.call(planDocsUpdate, {
          project: t.project,
          plan: t.plan,
          doc: t.doc,
          body,
          baseHash: options.overwrite ? s.hash : confirmed.current.hash,
        });
        confirmed.current = { body, hash: out.hash };
        setError(null);
        void queryClient.invalidateQueries({ queryKey: ["op"] });
        if (alive.current) setState("saved");
      } catch (err) {
        if (alive.current) {
          setError(describeError(err).message);
          setState("failed");
        }
        again.current = false;
        running.current = false;
        return;
      }
      running.current = false;
      if (again.current || isDirty()) {
        again.current = false;
        if (alive.current) setState("dirty");
        void flush();
      }
    },
    [core, isDirty, queryClient],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the stored text changes
  useEffect(() => {
    if (running.current || isDirty()) return;
    if (saved.body !== confirmed.current.body || saved.hash !== confirmed.current.hash) {
      confirmed.current = { body: saved.body, hash: saved.hash };
      onExt.current(saved.body);
    }
  }, [saved.body, saved.hash]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the draft triggers the timer
  useEffect(() => {
    if (!isDirty()) {
      setState((s) => (s === "dirty" ? "saved" : s));
      return;
    }
    setState((s) => (s === "saving" || s === "failed" ? s : "dirty"));
    const timer = setTimeout(() => void flush(), delayMs);
    return () => clearTimeout(timer);
  }, [draft, delayMs, flush, isDirty]);

  useEffect(() => {
    const onBlur = () => void flush();
    window.addEventListener("blur", onBlur);
    return () => window.removeEventListener("blur", onBlur);
  }, [flush]);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      void flush();
    };
  }, [flush]);

  return { state, error, flush };
}

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
  const [draft, setDraft] = useState(initial.body);
  const save = useDocAutosave({ project, plan, doc }, initial, draft, setDraft);
  const provider = useMemo(
    () => withNodeLinks(links.provider, nodes, t("plan.linkDetail")),
    [links.provider, nodes, t],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-4">
      <div className="mb-3 flex items-center justify-between gap-3 text-[12px] text-muted">
        <span>{hint ?? ""}</span>
        <span role="status" aria-live="polite" data-testid="save-state" data-state={save.state}>
          {save.state === "failed" ? (
            <span className="text-danger">
              {t("notes.saveFailed")}
              {save.error ? `: ${save.error}` : ""}{" "}
              <Button size="sm" onClick={() => void save.flush({ overwrite: true })}>
                {t("plan.doc.keepMine")}
              </Button>
            </span>
          ) : (
            t(STATE_KEY[save.state])
          )}
        </span>
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
