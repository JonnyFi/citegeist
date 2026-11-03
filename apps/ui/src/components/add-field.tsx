import { inboxAccept, itemsAdd, jobsGet } from "@citegeist/ops";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useId, useRef, useState } from "react";
import { type MessageKey, useI18n } from "../i18n";
import { useCore, useOpMutation } from "../lib/hooks";
import { classifyIdentifier } from "../lib/identifier";
import { cn, describeError } from "../lib/utils";
import { FileDrop, type FileDropResult, useFilePicker } from "./ui/file-drop";
import { Menu } from "./ui/menu";

/** What happened to one thing the person added: a typed identifier or one file. */
type RowState =
  | "pending"
  | "added"
  | "duplicate"
  /** The work is in the inbox. Adding does not accept it; the person decides. */
  | "inbox"
  | "accepted"
  | "unsupported"
  | "error";

interface Row {
  key: number;
  /** What the person gave: the identifier as typed, or the file name. */
  name: string;
  state: RowState;
  citekey?: string;
  /** The conversion job of an added item, followed until it names the item the file ended up in. */
  job?: string;
  message?: string;
}

const KIND_KEY = {
  doi: "add.kind.doi",
  arxiv: "add.kind.arxiv",
  isbn: "add.kind.isbn",
  pmid: "add.kind.pmid",
  url: "add.kind.url",
  bibtex: "add.kind.bibtex",
  path: "add.kind.path",
} as const satisfies Record<string, MessageKey>;

const TERMINAL = ["succeeded", "failed", "cancelled"];

/** The file types the core takes (`FILE_KINDS` in packages/core/src/ingest/service.ts). */
export const LIBRARY_FILE_TYPES = [".pdf", ".epub", ".html", ".htm"] as const;

/** Files dragged over the window carry "Files" in their data transfer types. */
function hasFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

/**
 * A file is sometimes recognised only after its conversion: the job then names the item the file
 * ended up in, which can differ from the one items.add answered with. Renders nothing.
 */
function JobFollower({
  job,
  citekey,
  onResult,
}: {
  job: string;
  citekey: string;
  onResult: (result: { citekey: string; state: "added" | "duplicate" | "inbox" }) => void;
}) {
  const core = useCore();
  const query = useQuery({
    queryKey: ["op", jobsGet.name, job],
    queryFn: () => core.call(jobsGet, { job }),
    refetchInterval: (q) => (TERMINAL.includes(q.state.data?.status ?? "") ? false : 600),
  });
  const data = query.data;
  useEffect(() => {
    if (data?.status !== "succeeded") return;
    const result = data.result as { citekey?: unknown; merged?: { inInbox?: unknown } } | undefined;
    if (typeof result?.citekey !== "string" || result.citekey === citekey) return;
    onResult({
      citekey: result.citekey,
      state: result.merged ? (result.merged.inInbox ? "inbox" : "duplicate") : "added",
    });
  }, [data, citekey, onResult]);
  return null;
}

/**
 * The add field of the library bar: a DOI, arXiv id or link, an ISBN or a URL goes into items.add,
 * and so does a file. Files come in through the drop area under the field, which opens while the
 * field has focus or a file is dragged over the window, or through the file dialog of the menu. A
 * person always adds to the library, never to the inbox
 * (docs/decisions/0014-agent-content-goes-to-inbox.md).
 */
export function AddField({ project }: { project?: string | undefined }) {
  const { t } = useI18n();
  const add = useOpMutation(itemsAdd);
  const accept = useOpMutation(inboxAccept);
  const id = useId();
  const [value, setValue] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [dragging, setDragging] = useState(false);
  const [focused, setFocused] = useState(false);
  const depth = useRef(0);
  const nextKey = useRef(0);
  const textField = useRef<HTMLInputElement>(null);

  const busy = rows.some((r) => r.state === "pending");
  const detected = classifyIdentifier(value);
  const hint =
    detected.kind in KIND_KEY ? t(KIND_KEY[detected.kind as keyof typeof KIND_KEY]) : null;

  // the answer goes away by itself; the summary of several files stays a little longer
  useEffect(() => {
    if (rows.length === 0 || busy) return;
    const timer = setTimeout(() => setRows([]), rows.length > 1 ? 15000 : 8000);
    return () => clearTimeout(timer);
  }, [rows, busy]);

  const patch = (key: number, change: Partial<Row>) =>
    setRows((current) => current.map((r) => (r.key === key ? { ...r, ...change } : r)));

  const submit = async (key: number, identifier: string) => {
    try {
      const out = await add.mutateAsync({
        identifier,
        target: "library",
        ...(project ? { projects: [project] } : {}),
      });
      patch(
        key,
        out.duplicateOf
          ? { state: out.inInbox ? "inbox" : "duplicate", citekey: out.duplicateOf }
          : { state: "added", citekey: out.citekey, job: out.job },
      );
    } catch (err) {
      patch(key, { state: "error", message: describeError(err).message });
    }
  };

  const newRow = (name: string, state: RowState, message?: string): Row => ({
    key: nextKey.current++,
    name,
    state,
    ...(message ? { message } : {}),
  });

  // Files go in one after the other. Each gets its row, so that the summary tells what became of
  // every file, and a file the core cannot take does not hold up the others.
  const addFiles = ({ files, rejected, unreadable }: FileDropResult) => {
    const queued = files.map((f) => ({ path: f.path, row: newRow(f.name, "pending") }));
    const next = [
      ...queued.map((q) => q.row),
      ...rejected.map((name) => newRow(name, "unsupported")),
      ...unreadable.map((name) => newRow(name, "error", t("add.noPath", { name }))),
    ];
    if (next.length === 0) return;
    setRows(next);
    void (async () => {
      for (const q of queued) await submit(q.row.key, q.path);
    })();
  };

  const picker = useFilePicker({
    accept: LIBRARY_FILE_TYPES,
    multiple: true,
    title: t("add.pick.title"),
    onFiles: addFiles,
    inputTestId: "pdf-file-input",
  });

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
    // A file dropped anywhere but on the drop area does nothing. Cancelling the event keeps the
    // window from opening the file.
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current = 0;
      setDragging(false);
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
  }, []);

  const showDrop = focused || dragging;
  const followed = rows.filter((r) => r.state === "added" && r.job && r.citekey);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const identifier = value.trim();
        if (!identifier || busy) return;
        const row = newRow(identifier, "pending");
        setRows([row]);
        void submit(row.key, identifier);
        setValue("");
      }}
      className="relative flex min-w-0 items-center gap-3"
    >
      <Menu
        label={t("add.menu")}
        trigger={t("add.menu")}
        className="inline-flex h-[26px] shrink-0 items-center border border-ink px-2.5 text-[12px] font-medium hover:bg-sunken"
        entries={[
          { label: t("add.pick"), onSelect: picker.choose },
          {
            label: t("add.menu.type"),
            onSelect: () => setTimeout(() => textField.current?.focus(), 0),
          },
        ]}
      />
      <input
        ref={textField}
        id={id}
        type="text"
        aria-label={t("add.label")}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={t("add.placeholder")}
        autoComplete="off"
        className="h-[30px] w-[420px] min-w-0 max-w-full border-0 border-b border-line bg-transparent px-0 text-[13px] placeholder:text-muted"
      />
      <button type="submit" hidden tabIndex={-1} aria-hidden="true" />
      {picker.input}
      {hint ? (
        <span className="shrink-0 font-mono text-[11px] text-muted" aria-live="polite">
          {hint}
        </span>
      ) : null}
      {busy ? (
        <span role="status" className="shrink-0 text-[12px] text-muted">
          {t("add.running")}
        </span>
      ) : null}
      {followed.map((r) => (
        <JobFollower
          key={r.key}
          job={r.job ?? ""}
          citekey={r.citekey ?? ""}
          onResult={(result) => patch(r.key, result)}
        />
      ))}
      {showDrop || rows.length > 0 ? (
        // A press on the panel must not take the focus from the field, or the drop area closes
        // before the click on its button arrives.
        // biome-ignore lint/a11y/noStaticElementInteractions: only keeps the focus where it is
        <div
          onMouseDown={(e) => e.preventDefault()}
          className="absolute right-0 top-[calc(100%+4px)] z-20 flex w-[480px] max-w-[calc(100vw-2rem)] flex-col gap-2 border border-line bg-bg p-2"
        >
          {showDrop ? (
            <FileDrop
              accept={LIBRARY_FILE_TYPES}
              multiple
              label={t("add.drop.label")}
              title={t("add.pick.title")}
              onFiles={addFiles}
            />
          ) : null}
          {rows.length > 0 ? (
            <Answer
              rows={rows}
              acceptPending={accept.isPending}
              onAccept={(row) =>
                accept.mutate(
                  { citekeys: [row.citekey ?? ""] },
                  { onSuccess: () => patch(row.key, { state: "accepted" }) },
                )
              }
            />
          ) : null}
        </div>
      ) : null}
    </form>
  );
}

const STATE_KEY = {
  added: "add.added",
  inbox: "add.inInbox",
  accepted: "add.accepted",
  duplicate: "add.duplicate",
} as const satisfies Record<string, MessageKey>;

/** The link to the item a row ended up in, with the button that accepts an inbox item. */
function RowResult({
  row,
  acceptPending,
  onAccept,
}: {
  row: Row;
  acceptPending: boolean;
  onAccept: (row: Row) => void;
}) {
  const { t } = useI18n();
  if (row.state === "error") return <>{row.message}</>;
  if (row.state === "unsupported") return <>{t("add.row.unsupported")}</>;
  if (row.state === "pending") return <>{t("add.row.pending")}</>;
  return (
    <>
      {t(STATE_KEY[row.state])}{" "}
      <Link
        to="/items/$citekey"
        params={{ citekey: row.citekey ?? "" }}
        className="font-mono underline"
      >
        {row.citekey}
      </Link>
      {row.state === "inbox" ? (
        <>
          {" "}
          <button
            type="button"
            className="underline"
            disabled={acceptPending}
            onClick={() => onAccept(row)}
          >
            {t("add.accept")}
          </button>
        </>
      ) : null}
    </>
  );
}

/**
 * What became of the things just added. One thing gets one sentence; several get a summary line
 * with the counts and a line for each file.
 */
function Answer({
  rows,
  acceptPending,
  onAccept,
}: {
  rows: readonly Row[];
  acceptPending: boolean;
  onAccept: (row: Row) => void;
}) {
  const { t } = useI18n();
  const [only] = rows;
  if (rows.length === 1 && only) {
    if (only.state === "pending") return null;
    const failed = only.state === "error";
    return (
      <div
        role={failed ? "alert" : "status"}
        className={cn("text-[12px]", failed && "text-danger")}
      >
        {only.state === "unsupported" ? (
          t("add.unsupported", { name: only.name })
        ) : (
          <RowResult row={only} acceptPending={acceptPending} onAccept={onAccept} />
        )}
      </div>
    );
  }
  const count = (...states: RowState[]) => rows.filter((r) => states.includes(r.state)).length;
  const unsupported = rows.filter((r) => r.state === "unsupported").map((r) => r.name);
  const parts = [
    count("pending") ? t("add.sum.pending", { n: count("pending") }) : "",
    count("added", "accepted") ? t("add.sum.added", { n: count("added", "accepted") }) : "",
    count("duplicate") ? t("add.sum.duplicate", { n: count("duplicate") }) : "",
    count("inbox") ? t("add.sum.inbox", { n: count("inbox") }) : "",
    count("error") ? t("add.sum.failed", { n: count("error") }) : "",
    unsupported.length
      ? t("add.sum.unsupported", { n: unsupported.length, names: unsupported.join(", ") })
      : "",
  ].filter(Boolean);
  return (
    <div className="flex flex-col gap-1.5 text-[12px]">
      <p role="status">{parts.join(", ")}</p>
      <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto border-t border-line-soft pt-1.5">
        {rows.map((row) => (
          <li key={row.key} className={cn("flex gap-2", row.state === "error" && "text-danger")}>
            <span className="min-w-0 max-w-[45%] shrink-0 truncate text-muted" title={row.name}>
              {row.name}
            </span>
            <span className="min-w-0 flex-1">
              <RowResult row={row} acceptPending={acceptPending} onAccept={onAccept} />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
