import { FileUp } from "lucide-react";
import { type DragEvent, type ReactNode, useRef, useState } from "react";
import { useI18n } from "../../i18n";
import { useCore } from "../../lib/hooks";
import { cn } from "../../lib/utils";
import { Button } from "./button";

/** A file or folder the person gave citegeist, with the path the core can read it from. */
export interface PickedFile {
  name: string;
  path: string;
}

/** What one drop or one choice in the file dialog came to. */
export interface FileDropResult {
  /** Files of an accepted type whose path is known. */
  files: PickedFile[];
  /** Names of files whose type is not in `accept`. */
  rejected: string[];
  /** Names of accepted files whose path the app cannot tell (a browser without the desktop bridge). */
  unreadable: string[];
}

export interface FilePickerOptions {
  /** Accepted file extensions with the dot, e.g. [".pdf", ".epub"]. Without it any file is accepted. */
  accept?: readonly string[] | undefined;
  /** Folders are accepted as well (a dropped folder, or a folder in the native dialog). */
  folders?: boolean | undefined;
  multiple?: boolean | undefined;
  /** Title of the native dialog. */
  title?: string | undefined;
  onFiles: (result: FileDropResult) => void;
}

interface Candidate {
  file: File;
  folder: boolean;
}

/** Files dragged over the page carry "Files" in their data transfer types. */
function carriesFiles(types: readonly string[] | undefined): boolean {
  return Array.from(types ?? []).includes("Files");
}

/** The files of a drop, each marked when it is a folder (only the items of the drop know that). */
function droppedCandidates(transfer: DataTransfer): Candidate[] {
  const folders = new Set<string>();
  for (const item of Array.from(transfer.items ?? [])) {
    if (item.kind !== "file") continue;
    const entry = item.webkitGetAsEntry?.();
    const file = item.getAsFile();
    if (entry?.isDirectory && file) folders.add(file.name);
  }
  return Array.from(transfer.files ?? []).map((file) => ({ file, folder: folders.has(file.name) }));
}

function hasExtension(name: string, accept: readonly string[] | undefined): boolean {
  if (!accept) return true;
  const lower = name.toLowerCase();
  return accept.some((ext) => lower.endsWith(ext.toLowerCase()));
}

function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

/**
 * Sorts dropped or chosen files into those the field takes, those of another type and those whose
 * path is unknown. The desktop app tells the path of a file (`pathForFile`); the browser preview
 * only has the name, which its mock core accepts.
 */
function sortFiles(
  candidates: readonly Candidate[],
  options: Pick<FilePickerOptions, "accept" | "folders" | "multiple">,
  isMock: boolean,
): FileDropResult {
  const result: FileDropResult = { files: [], rejected: [], unreadable: [] };
  for (const { file, folder } of candidates) {
    // a field for folders alone (no `accept`) takes nothing else
    const takes =
      folder && options.folders
        ? true
        : options.folders && !options.accept
          ? false
          : hasExtension(file.name, options.accept);
    if (!takes) {
      result.rejected.push(file.name);
      continue;
    }
    let path: string | undefined;
    try {
      path = window.citegeist?.pathForFile?.(file) || (isMock ? file.name : undefined);
    } catch {
      path = undefined;
    }
    if (path) result.files.push({ name: file.name, path });
    else result.unreadable.push(file.name);
  }
  if (!options.multiple) result.files.splice(1);
  return result;
}

/**
 * The file dialog of the app. In the desktop app it is the native one, which answers with paths;
 * in the browser preview it is a plain file input. `input` is that hidden input and has to be
 * rendered next to whatever calls `choose`.
 */
export function useFilePicker(options: FilePickerOptions & { inputTestId?: string }) {
  const core = useCore();
  const input = useRef<HTMLInputElement>(null);
  const { accept, folders, multiple, title, onFiles } = options;
  const extensions = accept?.map((ext) => ext.replace(/^\./, ""));
  // a file input cannot choose a folder, so a field for folders alone needs the native dialog
  const native = window.citegeist?.pickPaths;
  const canChoose = Boolean(native) || !folders || Boolean(accept);

  const choose = () => {
    if (!native) {
      input.current?.click();
      return;
    }
    void native({
      kind: folders ? (accept ? "any" : "folder") : "file",
      ...(multiple ? { multiple: true } : {}),
      ...(extensions ? { extensions } : {}),
      ...(title ? { title } : {}),
    }).then((paths) => {
      if (paths.length === 0) return;
      const chosen = multiple ? paths : paths.slice(0, 1);
      onFiles({
        files: chosen.map((path) => ({ name: basename(path), path })),
        rejected: [],
        unreadable: [],
      });
    });
  };

  const hiddenInput = (
    <input
      ref={input}
      type="file"
      accept={accept?.join(",")}
      multiple={multiple}
      hidden
      tabIndex={-1}
      data-testid={options.inputTestId ?? "file-drop-input"}
      onChange={(e) => {
        const files = Array.from(e.target.files ?? []).map((file) => ({ file, folder: false }));
        e.target.value = "";
        onFiles(sortFiles(files, { accept, folders, multiple }, core.isMock));
      }}
    />
  );
  return { choose, canChoose, input: hiddenInput };
}

/**
 * Dashed drop area with a button for the file dialog. It highlights while a file is dragged over
 * it and hands the paths of what was dropped or chosen to `onFiles`. A drop outside the area does
 * nothing.
 */
export function FileDrop({
  label,
  chooseLabel,
  chooseName,
  className,
  children,
  ...picker
}: FilePickerOptions & {
  /** Sentence in the area, e.g. "Drop files here or". The button follows it. */
  label: string;
  /** Text of the button. Default: "Choose file". */
  chooseLabel?: string;
  /** Accessible name of the button when several areas share a screen. */
  chooseName?: string;
  className?: string;
  /** Extra line under the sentence, e.g. the accepted types. */
  children?: ReactNode;
}) {
  const { t } = useI18n();
  const core = useCore();
  const [over, setOver] = useState(false);
  // dragenter and dragleave also fire for every child, so the highlight counts how deep the pointer is
  const depth = useRef(0);
  const { choose, canChoose, input } = useFilePicker(picker);

  const enter = (e: DragEvent) => {
    if (!carriesFiles(e.dataTransfer?.types)) return;
    e.preventDefault();
    depth.current += 1;
    setOver(true);
  };
  const leave = (e: DragEvent) => {
    if (!carriesFiles(e.dataTransfer?.types)) return;
    depth.current = Math.max(0, depth.current - 1);
    if (depth.current === 0) setOver(false);
  };
  const drop = (e: DragEvent) => {
    if (!carriesFiles(e.dataTransfer?.types)) return;
    e.preventDefault();
    depth.current = 0;
    setOver(false);
    picker.onFiles(sortFiles(droppedCandidates(e.dataTransfer), picker, core.isMock));
  };

  return (
    <section
      aria-label={label}
      data-testid="file-drop"
      data-over={over ? "true" : undefined}
      onDragEnter={enter}
      onDragOver={(e) => {
        if (carriesFiles(e.dataTransfer?.types)) e.preventDefault();
      }}
      onDragLeave={leave}
      onDrop={drop}
      className={cn(
        "flex items-center gap-3 border border-dashed px-3 py-2.5 text-[12px] transition-colors",
        over ? "border-ink bg-sunken text-ink" : "border-line-faint text-muted",
        className,
      )}
    >
      <FileUp aria-hidden="true" className="size-4 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1.5">
        <span>{label}</span>
        {canChoose ? (
          <Button size="sm" {...(chooseName ? { "aria-label": chooseName } : {})} onClick={choose}>
            {chooseLabel ?? t("filedrop.choose")}
          </Button>
        ) : null}
        {children}
      </div>
      {canChoose ? input : null}
    </section>
  );
}
