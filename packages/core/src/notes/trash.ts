import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { type Actor, CitegeistError } from "@citegeist/schema";
import type { ChangeEvent, Library } from "../library.js";

/** What `trashed.json` next to a trashed note says. */
interface TrashedNote {
  id?: string;
  /** Root-relative path the note had, where notes.restore puts it back. */
  path?: string;
}

function readMarker(dir: string): TrashedNote | undefined {
  try {
    return JSON.parse(readFileSync(join(dir, "trashed.json"), "utf8")) as TrashedNote;
  } catch {
    return undefined;
  }
}

/**
 * D7 for deletion: a person may trash any note, an agent only a note an agent created. Moves the
 * file into <library>/.trash/note-<id>-<stamp>/ and leaves a trashed.json next to it that says who
 * trashed it, when, and where it was.
 */
export function trashNote(lib: Library, id: string, actor: Actor = "human"): { trashedTo: string } {
  const note = lib.getNote(id);
  if (
    actor !== "human" &&
    actor !== "system" &&
    !note.frontmatter.created.by.startsWith("agent:")
  ) {
    throw new CitegeistError({
      code: "TRASH_NOT_ALLOWED",
      message: `${actor} may not trash the note '${note.frontmatter.title}': the user wrote it`,
      fix: "Ask the user to delete it in the app. Agents can trash notes an agent created.",
      recovery: "ask-human",
      context: { id },
    });
  }
  const rel = lib.paths.rel(note.path);
  const trash = join(lib.root, ".trash");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  let dest = join(trash, `note-${id}-${stamp}`);
  for (let n = 2; existsSync(dest); n++) dest = join(trash, `note-${id}-${stamp}-${n}`);
  mkdirSync(dest, { recursive: true });
  renameSync(note.path, join(dest, basename(rel)));
  writeFileSync(
    join(dest, "trashed.json"),
    `${JSON.stringify({ id, path: rel, ...lib.stamp(actor) }, null, 2)}\n`,
  );
  const result = lib.indexer.removePath(rel);
  if (result.status === "removed") {
    lib.emit("change", { rel, status: "removed", external: false } satisfies ChangeEvent);
  }
  return { trashedTo: dest };
}

/** notes.restore: moves the newest trashed copy of a note back to its old path and indexes it. */
export function restoreNote(lib: Library, id: string) {
  const fail = (code: string, message: string, fix: string) =>
    new CitegeistError({ code, message, fix, recovery: "fix-and-retry", context: { id } });
  if (lib.index.get("SELECT id FROM notes WHERE id = ?", id)) {
    throw fail("NOTE_EXISTS", `the note '${id}' is in the library`, "Nothing to restore.");
  }
  const trash = join(lib.root, ".trash");
  const newest = existsSync(trash)
    ? readdirSync(trash)
        .filter(
          (name) => name.startsWith(`note-${id}-`) && readMarker(join(trash, name))?.id === id,
        )
        .sort()
        .at(-1)
    : undefined;
  const rel = newest ? readMarker(join(trash, newest))?.path : undefined;
  if (!newest || !rel) {
    throw fail(
      "NOT_IN_TRASH",
      `no trashed note with id '${id}'`,
      "Check the note id, or look in the .trash folder of the library.",
    );
  }
  const target = lib.paths.abs(rel);
  if (existsSync(target)) {
    throw fail(
      "NOTE_PATH_TAKEN",
      `cannot restore the note: ${rel} exists again`,
      "Rename the note that is there, then restore.",
    );
  }
  const from = join(trash, newest);
  mkdirSync(dirname(target), { recursive: true });
  renameSync(join(from, basename(rel)), target);
  rmSync(from, { recursive: true, force: true });
  const result = lib.indexer.indexFile(rel);
  lib.emit("change", { ...result, external: false } satisfies ChangeEvent);
  return lib.getNote(id);
}
