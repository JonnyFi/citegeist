import {
  type Backlink,
  type NoteSummary,
  notesBacklinks,
  notesList,
} from "@citegeist/editor/contracts";
import type { Registry } from "@citegeist/ops";
import type { Library } from "../library.js";

interface NoteRow {
  id: string;
  slug: string;
  title: string;
  type: NoteSummary["type"];
  created: string;
  modified: string | null;
  frontmatter_json: string;
}

interface LinkRow {
  src_kind: "item" | "card" | "note";
  src_ref: string;
  rel: string | null;
  status: "proposed" | "accepted";
  origin: string;
}

/** Substring match that treats LIKE wildcards in the user's text literally. */
function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** Notes, newest change first. */
export function listNotes(
  lib: Library,
  input: { query?: string | undefined; project?: string | undefined; limit: number },
) {
  const where: string[] = [];
  const params: unknown[] = [];
  if (input.query) {
    where.push("(n.title LIKE ? ESCAPE '\\' OR n.slug LIKE ? ESCAPE '\\')");
    params.push(likePattern(input.query), likePattern(input.query));
  }
  if (input.project) {
    where.push(
      "EXISTS (SELECT 1 FROM project_members pm WHERE pm.kind = 'note' AND pm.ref = n.id AND pm.project = ?)",
    );
    params.push(input.project);
  }
  const rows = lib.index.all<NoteRow>(
    `SELECT n.id, n.slug, n.title, n.type, n.created, n.modified, n.frontmatter_json
     FROM notes n
     ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
     ORDER BY COALESCE(n.modified, n.created) DESC, n.id DESC LIMIT ?`,
    ...params,
    input.limit,
  );
  return rows.map((r) => {
    const fm = JSON.parse(r.frontmatter_json) as { tags?: string[]; projects?: string[] };
    return {
      id: r.id,
      slug: r.slug,
      title: r.title,
      type: r.type,
      created: r.created,
      ...(r.modified ? { modified: r.modified } : {}),
      tags: fm.tags ?? [],
      projects: fm.projects ?? [],
    };
  });
}

/** Sources that point at a note, by wiki link or typed link, with a title for display. */
export function noteBacklinks(lib: Library, id: string): Backlink[] {
  const rows = lib.index.all<LinkRow>(
    `SELECT src_kind, src_ref, rel, status, origin FROM resolved_links
     WHERE dst_kind = 'note' AND dst_ref = ? AND NOT (src_kind = 'note' AND src_ref = ?)
     ORDER BY src_kind, src_ref`,
    id,
    id,
  );
  const out: Backlink[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const key = `${r.src_kind}:${r.src_ref}:${r.rel ?? ""}:${r.origin}`;
    if (seen.has(key)) continue;
    seen.add(key);
    let title: string | undefined;
    let citekey: string | undefined;
    if (r.src_kind === "note") {
      title = lib.index.get<{ title: string }>(
        "SELECT title FROM notes WHERE id = ?",
        r.src_ref,
      )?.title;
    } else if (r.src_kind === "item") {
      title = lib.index.get<{ title: string }>(
        "SELECT title FROM items WHERE citekey = ?",
        r.src_ref,
      )?.title;
      citekey = r.src_ref;
    } else {
      const card = lib.index.get<{ quote: string; citekey: string }>(
        "SELECT quote, citekey FROM cards WHERE id = ?",
        r.src_ref,
      );
      title = card?.quote.replace(/\s+/g, " ").slice(0, 80);
      citekey = card?.citekey;
    }
    if (title === undefined) continue;
    out.push({
      kind: r.src_kind,
      id: r.src_ref,
      ...(citekey ? { citekey } : {}),
      title,
      ...(r.rel ? { rel: r.rel } : {}),
      status: r.status,
      origin: r.origin === "frontmatter" ? "frontmatter" : "wiki",
    });
  }
  return out;
}

/**
 * Binds the notes operations that have no contract in packages/ops yet (notes.list,
 * notes.backlinks). Call it next to bindCoreOperations in the runtime.
 */
export function bindNoteOperations(registry: Registry, lib: Library): Registry {
  return registry
    .bind(notesList, async (_ctx, input) => ({ notes: listNotes(lib, input) }))
    .bind(notesBacklinks, async (_ctx, input) => ({ backlinks: noteBacklinks(lib, input.id) }));
}
