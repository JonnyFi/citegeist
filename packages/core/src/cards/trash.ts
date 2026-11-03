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

/** What `trashed.json` next to a trashed card says. */
interface TrashedCard {
  id?: string;
  /** Root-relative path the card had, where cards.restore puts it back. */
  path?: string;
}

function readMarker(dir: string): TrashedCard | undefined {
  try {
    return JSON.parse(readFileSync(join(dir, "trashed.json"), "utf8")) as TrashedCard;
  } catch {
    return undefined;
  }
}

/** Who refers to a card: typed links and wiki links to it, and the links that start at it. */
function referencesTo(lib: Library, id: string, cardPath: string): string[] {
  const rows = lib.index.all<{ src_kind: string; src_ref: string; dst: string }>(
    `SELECT DISTINCT src_kind, src_ref, dst FROM links
     WHERE path <> ?
       AND (dst = ? OR evidence = ? OR (src_kind = 'card' AND src_ref = ? AND origin = 'frontmatter'))`,
    cardPath,
    id,
    id,
    id,
  );
  const label = (kind: string, ref: string): string => {
    if (kind === "card") return `card ${ref}`;
    const title = lib.index.get<{ title: string }>(
      "SELECT title FROM notes WHERE id = ?",
      ref,
    )?.title;
    return title ? `note '${title}' (${ref})` : `note ${ref}`;
  };
  const out = rows.map((r) =>
    r.src_ref === id
      ? `its own link to ${r.dst} in the literature note`
      : `${label(r.src_kind, r.src_ref)}`,
  );
  return [...new Set(out)];
}

/**
 * Moves a card file into <library>/.trash/card-<id>-<stamp>/ with a trashed.json that says who
 * trashed it, when, and where it was. Only a person may delete a card, and not while a link or a
 * note refers to it: the error names the references.
 */
export function trashCard(lib: Library, id: string, actor: Actor = "human"): { trashedTo: string } {
  const row = lib.index.get<{ path: string }>("SELECT path FROM cards WHERE id = ?", id);
  if (!row) {
    throw new CitegeistError({
      code: "CARD_NOT_FOUND",
      message: `no card with id '${id}'`,
      fix: "Call cards.list to find the right card id.",
      recovery: "fix-and-retry",
      context: { id },
    });
  }
  if (actor !== "human" && actor !== "system") {
    throw new CitegeistError({
      code: "TRASH_NOT_ALLOWED",
      message: `${actor} may not delete the card '${id}': only a person deletes cards`,
      fix: "Ask the user to delete it in the app.",
      recovery: "ask-human",
      context: { id },
    });
  }
  const refs = referencesTo(lib, id, row.path);
  if (refs.length > 0) {
    throw new CitegeistError({
      code: "CARD_REFERENCED",
      message: `the card '${id}' cannot be deleted: ${refs.join("; ")} refer to it`,
      fix: "Remove those links or edit those notes first, then delete the card.",
      recovery: "do-first",
      context: { id, references: refs },
    });
  }
  const trash = join(lib.root, ".trash");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  let dest = join(trash, `card-${id}-${stamp}`);
  for (let n = 2; existsSync(dest); n++) dest = join(trash, `card-${id}-${stamp}-${n}`);
  mkdirSync(dest, { recursive: true });
  renameSync(lib.paths.abs(row.path), join(dest, basename(row.path)));
  writeFileSync(
    join(dest, "trashed.json"),
    `${JSON.stringify({ id, path: row.path, ...lib.stamp(actor) }, null, 2)}\n`,
  );
  const result = lib.indexer.removePath(row.path);
  if (result.status === "removed") {
    lib.emit("change", { rel: row.path, status: "removed", external: false } satisfies ChangeEvent);
  }
  return { trashedTo: dest };
}

/** cards.restore: moves the newest trashed copy of a card back to its old path and indexes it. */
export function restoreCard(lib: Library, id: string): void {
  const fail = (code: string, message: string, fix: string) =>
    new CitegeistError({ code, message, fix, recovery: "fix-and-retry", context: { id } });
  if (lib.index.get("SELECT id FROM cards WHERE id = ?", id)) {
    throw fail("CARD_EXISTS", `the card '${id}' is in the library`, "Nothing to restore.");
  }
  const trash = join(lib.root, ".trash");
  const newest = existsSync(trash)
    ? readdirSync(trash)
        .filter(
          (name) => name.startsWith(`card-${id}-`) && readMarker(join(trash, name))?.id === id,
        )
        .sort()
        .at(-1)
    : undefined;
  const rel = newest ? readMarker(join(trash, newest))?.path : undefined;
  if (!newest || !rel) {
    throw fail(
      "NOT_IN_TRASH",
      `no trashed card with id '${id}'`,
      "Check the card id, or look in the .trash folder of the library.",
    );
  }
  const target = lib.paths.abs(rel);
  if (existsSync(target)) {
    throw fail(
      "CARD_PATH_TAKEN",
      `cannot restore the card: ${rel} exists again`,
      "Rename the file that is there, then restore.",
    );
  }
  const from = join(trash, newest);
  mkdirSync(dirname(target), { recursive: true });
  renameSync(join(from, basename(rel)), target);
  rmSync(from, { recursive: true, force: true });
  const result = lib.indexer.indexFile(rel);
  lib.emit("change", { ...result, external: false } satisfies ChangeEvent);
}
