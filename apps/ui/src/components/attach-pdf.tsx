import { itemsAttach } from "@citegeist/ops";
import { FileUp } from "lucide-react";
import { type DragEvent, type ReactNode, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { useCore, useOpMutation } from "../lib/hooks";
import { cn, describeError } from "../lib/utils";
import { Button } from "./ui/button";

type Outcome = { kind: "ok" | "error"; text: string };

/**
 * "PDF anhängen" for a source without full text. The button opens the native file dialog in the
 * desktop app and a plain file input in the browser preview; a PDF dropped on the block works as
 * well. items.attach copies the file into the item and starts its conversion.
 */
export function AttachPdf({
  citekey,
  variant = "block",
  alongside,
}: {
  citekey: string;
  variant?: "block" | "button";
  /** Another action next to the attach button, such as searching the full text again. */
  alongside?: ReactNode;
}) {
  const { t } = useI18n();
  const core = useCore();
  const attach = useOpMutation(itemsAttach);
  const input = useRef<HTMLInputElement>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const attachPath = (path: string) => {
    setOutcome(null);
    attach.mutate(
      { citekey, path },
      {
        onSuccess: (out) =>
          setOutcome({ kind: "ok", text: out.added ? t("attach.done") : t("attach.exists") }),
        onError: (err) =>
          setOutcome({
            kind: "error",
            text: t("attach.failed", { message: describeError(err).message }),
          }),
      },
    );
  };

  const attachFiles = (files: File[]) => {
    const file = files[0];
    if (!file) return;
    if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") {
      setOutcome({ kind: "error", text: t("add.notPdf", { name: file.name }) });
      return;
    }
    // the desktop app tells the path of a dropped file; the browser preview only has the name
    const path = window.citegeist?.pathForFile?.(file) ?? (core.isMock ? file.name : undefined);
    if (!path) {
      setOutcome({ kind: "error", text: t("add.noPath", { name: file.name }) });
      return;
    }
    attachPath(path);
  };

  const choose = () => {
    const pick = window.citegeist?.pickPaths;
    if (!pick) {
      input.current?.click();
      return;
    }
    void pick({ kind: "file", extensions: ["pdf"], title: t("attach.button") }).then((paths) => {
      if (paths[0]) attachPath(paths[0]);
    });
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    attachFiles(Array.from(e.dataTransfer.files));
  };

  const button = (
    <Button variant="primary" disabled={attach.isPending} onClick={choose}>
      <FileUp className="size-3.5" />
      {attach.isPending ? t("attach.running") : t("attach.button")}
    </Button>
  );
  const hidden = (
    <input
      ref={input}
      type="file"
      accept="application/pdf,.pdf"
      hidden
      data-testid="attach-file-input"
      onChange={(e) => {
        attachFiles(Array.from(e.target.files ?? []));
        e.target.value = "";
      }}
    />
  );
  const status = outcome ? (
    <span
      role={outcome.kind === "error" ? "alert" : "status"}
      className={cn("text-[12px]", outcome.kind === "error" ? "text-danger" : "text-muted")}
    >
      {outcome.text}
    </span>
  ) : null;

  if (variant === "button") {
    return (
      <div className="flex flex-col items-center gap-2">
        {button}
        {status}
        {hidden}
      </div>
    );
  }
  return (
    <section
      aria-label={t("attach.title")}
      data-testid="attach-pdf"
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      className="flex flex-col gap-2 border border-dashed border-ink px-3 py-3 text-[13px]"
    >
      <span className="font-medium">{t("attach.title")}</span>
      <span className="text-muted">{t("attach.text")}</span>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {button}
        {alongside}
        <span className="text-[12px] text-muted">{t("attach.drop")}</span>
      </div>
      {status}
      {hidden}
    </section>
  );
}
