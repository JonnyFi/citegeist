import { itemsAdd } from "@citegeist/ops";
import { Link } from "@tanstack/react-router";
import { FileUp } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { type MessageKey, useI18n } from "../i18n";
import { useCore, useOpMutation } from "../lib/hooks";
import { classifyIdentifier } from "../lib/identifier";
import { cn, describeError } from "../lib/utils";
import { Label } from "./layout";

type Outcome =
  | { kind: "added"; citekey: string }
  | { kind: "duplicate"; citekey: string }
  | { kind: "error"; message: string };

const KIND_KEY = {
  doi: "add.kind.doi",
  arxiv: "add.kind.arxiv",
  isbn: "add.kind.isbn",
  pmid: "add.kind.pmid",
  url: "add.kind.url",
  bibtex: "add.kind.bibtex",
  path: "add.kind.path",
} as const satisfies Record<string, MessageKey>;

/** Files dragged over the window carry "Files" in their data transfer types. */
function hasFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

/**
 * The add field of the library bar: a DOI, arXiv id or link, an ISBN or a URL goes into items.add,
 * and so does a PDF dropped anywhere on the window. A person always adds to the library, never to
 * the inbox (D7).
 */
export function AddField({ project }: { project?: string | undefined }) {
  const { t } = useI18n();
  const core = useCore();
  const add = useOpMutation(itemsAdd);
  const id = useId();
  const [value, setValue] = useState("");
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);

  const detected = classifyIdentifier(value);
  const hint =
    detected.kind in KIND_KEY ? t(KIND_KEY[detected.kind as keyof typeof KIND_KEY]) : null;

  useEffect(() => {
    if (!outcome) return;
    const timer = setTimeout(() => setOutcome(null), 8000);
    return () => clearTimeout(timer);
  }, [outcome]);

  const submit = (identifier: string) =>
    add.mutate(
      { identifier, target: "library", ...(project ? { projects: [project] } : {}) },
      {
        onSuccess: (out) =>
          setOutcome(
            out.duplicateOf
              ? { kind: "duplicate", citekey: out.duplicateOf }
              : { kind: "added", citekey: out.citekey },
          ),
        onError: (err) => setOutcome({ kind: "error", message: describeError(err).message }),
      },
    );

  const dropFiles = (files: File[]) => {
    for (const file of files) {
      if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") {
        setOutcome({ kind: "error", message: t("add.notPdf", { name: file.name }) });
        continue;
      }
      // the desktop app tells the path of a dropped file; the browser preview only has the name
      const path = window.citegeist?.pathForFile?.(file) ?? (core.isMock ? file.name : undefined);
      if (!path) {
        setOutcome({ kind: "error", message: t("add.noPath", { name: file.name }) });
        continue;
      }
      submit(path);
    }
  };

  useEffect(() => {
    const over = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth.current += 1;
      setDragging(true);
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(false);
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current = 0;
      setDragging(false);
      dropFiles(Array.from(e.dataTransfer?.files ?? []));
    };
    window.addEventListener("dragover", over);
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const identifier = value.trim();
        if (!identifier || add.isPending) return;
        setOutcome(null);
        submit(identifier);
        setValue("");
      }}
      className="relative flex min-w-0 items-center gap-3"
    >
      <label htmlFor={id}>
        <Label className="font-medium tracking-[0.08em]">{t("add.label")}</Label>
      </label>
      <input
        id={id}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={t("add.placeholder")}
        autoComplete="off"
        className="h-[30px] w-[420px] min-w-0 max-w-full border-0 border-b border-line bg-transparent px-0 text-[13px] placeholder:text-muted"
      />
      {hint ? (
        <span className="shrink-0 font-mono text-[11px] text-muted" aria-live="polite">
          {hint}
        </span>
      ) : null}
      {add.isPending ? (
        <span role="status" className="shrink-0 text-[12px] text-muted">
          {t("add.running")}
        </span>
      ) : null}
      {outcome ? (
        <div
          role={outcome.kind === "error" ? "alert" : "status"}
          className={cn(
            "absolute right-0 top-[calc(100%+4px)] z-20 max-w-[480px] border bg-bg px-3 py-2 text-[12px]",
            outcome.kind === "error" ? "border-danger text-danger" : "border-line",
          )}
        >
          {outcome.kind === "error" ? (
            outcome.message
          ) : (
            <>
              {outcome.kind === "added" ? t("add.added") : t("add.duplicate")}{" "}
              <Link
                to="/items/$citekey"
                params={{ citekey: outcome.citekey }}
                className="font-mono underline"
              >
                {outcome.citekey}
              </Link>
            </>
          )}
        </div>
      ) : null}
      {dragging ? (
        <div
          aria-hidden="true"
          data-testid="drop-overlay"
          className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center border-2 border-ink bg-bg/85"
        >
          <span className="flex items-center gap-3 font-serif text-[22px] font-medium">
            <FileUp className="size-6" />
            {t("add.drop")}
          </span>
        </div>
      ) : null}
    </form>
  );
}
