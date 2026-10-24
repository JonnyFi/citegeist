import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { type Actor, CitegeistError, ItemFrontmatter } from "@citegeist/schema";
import { MarkdownFile } from "../frontmatter.js";
import type { ChangeEvent, Library } from "../library.js";

export function problem(
  code: string,
  message: string,
  fix: string,
  context: Record<string, unknown> = {},
  recovery: "retry" | "fix-and-retry" | "do-first" | "ask-human" = "fix-and-retry",
): CitegeistError {
  return new CitegeistError({ code, message, fix, recovery, context });
}

/** An item file read from disk: the parsed pieces plus its root-relative path. */
export interface LoadedItem {
  file: MarkdownFile;
  fm: ItemFrontmatter;
  rel: string;
}

export function loadItem(lib: Library, citekey: string): LoadedItem {
  const got = lib.getItem(citekey);
  const rel = lib.paths.rel(got.path);
  return { file: MarkdownFile.parse(readFileSync(got.path, "utf8")), fm: got.frontmatter, rel };
}

/** Patches top-level frontmatter keys, stamps `modified` and writes the file through the core. */
export function saveItem(
  lib: Library,
  actor: Actor,
  item: LoadedItem,
  patch: Record<string, unknown>,
): void {
  item.file.patch({ ...patch, modified: lib.stamp(actor) });
  lib.writeFile(item.rel, item.file.toString());
}

function emitRemoved(lib: Library, results: { rel: string; status: string }[]): void {
  for (const r of results) {
    if (r.status === "removed") {
      lib.emit("change", { rel: r.rel, status: "removed", external: false } satisfies ChangeEvent);
    }
  }
}

// items.update -----------------------------------------------------------------------------------

const PROTECTED = new Set([
  "id",
  "citekey",
  "created",
  "modified",
  "sources",
  "inbox",
  "provenance",
]);
/** Keys that are not bibliographic data, so a change does not become field provenance. */
const NO_PROVENANCE = new Set(["tags", "projects", "status", "ai_language"]);

/** `patch` replaces top-level keys; a value of null removes the key. */
export function updateItem(
  lib: Library,
  actor: Actor,
  citekey: string,
  patch: Record<string, unknown>,
): { frontmatter: ItemFrontmatter } {
  const item = loadItem(lib, citekey);
  for (const k of Object.keys(patch)) {
    if (PROTECTED.has(k)) {
      throw problem(
        "INVALID_PATCH",
        `field '${k}' of item ${citekey} cannot be changed with items.update`,
        k === "citekey"
          ? "Use items.rename to change the citekey."
          : k === "inbox"
            ? "Use inbox.accept or inbox.reject."
            : `Remove '${k}' from the patch.`,
        { citekey, field: k },
      );
    }
  }
  const merged: Record<string, unknown> = { ...(item.file.data ?? {}) };
  const today = lib.stamp(actor).at.slice(0, 10);
  const provenance: Record<string, string> = { ...(item.fm.provenance ?? {}) };
  const filePatch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete merged[k];
    else merged[k] = v;
    filePatch[k] = v === null ? undefined : v;
    if (!NO_PROVENANCE.has(k)) {
      if (v === null) delete provenance[k];
      else provenance[k] = `${actor}@${today}`;
    }
  }
  merged.provenance = provenance;
  merged.modified = lib.stamp(actor);
  const check = ItemFrontmatter.safeParse(merged);
  if (!check.success) {
    throw problem(
      "INVALID_PATCH",
      `patch makes item ${citekey} invalid: ${check.error.issues
        .slice(0, 5)
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`,
      "Fix the patch values so that they match the item schema.",
      { citekey },
    );
  }
  filePatch.provenance = provenance;
  saveItem(lib, actor, item, filePatch);
  return { frontmatter: lib.getItem(citekey).frontmatter };
}

// items.trash, inbox.* --------------------------------------------------------------------------

/** Cards of the item and links to it from anywhere outside its own folder. */
export function isCited(lib: Library, citekey: string): boolean {
  const cards =
    lib.index.get<{ n: number }>("SELECT COUNT(*) AS n FROM cards WHERE citekey = ?", citekey)?.n ??
    0;
  if (cards > 0) return true;
  const links =
    lib.index.get<{ n: number }>(
      "SELECT COUNT(*) AS n FROM links WHERE dst = ? AND path NOT LIKE ?",
      citekey,
      `items/${citekey}/%`,
    )?.n ?? 0;
  return links > 0;
}

/**
 * D7 for deletion: a person may trash anything. An agent may trash an item that is in the inbox,
 * that an agent added or that is incomplete, and only while no card or link refers to it.
 * Everything else is the user's to remove.
 */
export function assertMayTrash(lib: Library, actor: Actor, citekey: string): void {
  const item = loadItem(lib, citekey);
  if (actor === "human" || actor === "system") return;
  const own = item.fm.inbox !== undefined || item.fm.created.by.startsWith("agent:");
  const broken = item.fm.incomplete !== undefined;
  if (!own && !broken) {
    throw problem(
      "TRASH_NOT_ALLOWED",
      `${actor} may not trash ${citekey}: the user added it to the library`,
      "Ask the user to remove it in the app or with items.trash on the command line. Agents can trash inbox items, incomplete items and items an agent added.",
      { citekey },
      "ask-human",
    );
  }
  if (isCited(lib, citekey)) {
    throw problem(
      "TRASH_NOT_ALLOWED",
      `${citekey} has quote cards or links that refer to it, so ${actor} may not trash it`,
      "Ask the user to remove the item, or leave it in place.",
      { citekey },
      "ask-human",
    );
  }
}

/**
 * Moves the item folder (sources, derived files, cards) into <library>/.trash and leaves a
 * trashed.json next to it that says who trashed it and when.
 */
export function trashItem(
  lib: Library,
  citekey: string,
  actor: Actor = "human",
): { trashedTo: string } {
  loadItem(lib, citekey);
  const trash = join(lib.root, ".trash");
  mkdirSync(trash, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  let dest = join(trash, `${citekey}-${stamp}`);
  for (let n = 2; existsSync(dest); n++) dest = join(trash, `${citekey}-${stamp}-${n}`);
  renameSync(lib.paths.itemDir(citekey), dest);
  writeFileSync(
    join(dest, "trashed.json"),
    `${JSON.stringify({ citekey, ...lib.stamp(actor) }, null, 2)}\n`,
  );
  emitRemoved(lib, lib.indexer.removeUnder(`items/${citekey}`));
  return { trashedTo: dest };
}

/**
 * items.restore: moves the newest trashed folder of a citekey back to `items/` and indexes it
 * again. The marker `trashed.json` is removed.
 */
export function restoreItem(lib: Library, citekey: string): void {
  if (existsSync(lib.paths.itemDir(citekey))) {
    throw problem(
      "CITEKEY_TAKEN",
      `cannot restore ${citekey}: an item with that citekey exists again`,
      "Rename the item that is there, then restore.",
      { citekey },
    );
  }
  const trash = join(lib.root, ".trash");
  const candidates = existsSync(trash)
    ? readdirSync(trash)
        .filter(
          (name) => name.startsWith(`${citekey}-`) && existsSync(join(trash, name, "trashed.json")),
        )
        .filter((name) => {
          try {
            const meta = JSON.parse(readFileSync(join(trash, name, "trashed.json"), "utf8")) as {
              citekey?: string;
            };
            return meta.citekey === citekey;
          } catch {
            return false;
          }
        })
        .sort()
    : [];
  const newest = candidates[candidates.length - 1];
  if (!newest) {
    throw problem(
      "NOT_IN_TRASH",
      `no trashed item with citekey ${citekey}`,
      "Check the citekey, or look in the .trash folder of the library.",
      { citekey },
    );
  }
  const from = join(trash, newest);
  renameSync(from, lib.paths.itemDir(citekey));
  rmSync(join(lib.paths.itemDir(citekey), "trashed.json"), { force: true });
  const rel = `items/${citekey}/${citekey}.md`;
  const result = lib.indexer.indexFile(rel);
  lib.emit("change", { ...result, external: false } satisfies ChangeEvent);
  lib.sync();
}

export function acceptInbox(lib: Library, actor: Actor, citekeys: string[]): void {
  const items = citekeys.map((c) => loadItem(lib, c));
  for (const item of items) {
    if (item.fm.inbox) saveItem(lib, actor, item, { inbox: undefined });
  }
}

export function rejectInbox(lib: Library, citekeys: string[], actor: Actor = "human"): void {
  const items = citekeys.map((c) => loadItem(lib, c));
  for (const item of items) {
    if (!item.fm.inbox) {
      throw problem(
        "NOT_IN_INBOX",
        `item ${item.fm.citekey} is in the library, not in the inbox`,
        "Use items.trash to remove an item from the library.",
        { citekey: item.fm.citekey },
      );
    }
  }
  for (const item of items) trashItem(lib, item.fm.citekey, actor);
}

// items.rename -----------------------------------------------------------------------------------

const CODE = /```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`/g;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Rewrites [[from]], [[from#anchor]], [[from|alias]] and embeds outside of code. */
export function rewriteWikiLinks(
  text: string,
  from: string,
  to: string,
): { text: string; count: number } {
  const re = new RegExp(`(\\[\\[\\s*)${escapeRegExp(from)}(\\s*(?:[#|][^\\]]*)?\\]\\])`, "g");
  let count = 0;
  const rewrite = (s: string): string =>
    s.replace(re, (_m, a: string, b: string) => {
      count++;
      return `${a}${to}${b}`;
    });
  let out = "";
  let last = 0;
  for (const m of text.matchAll(CODE)) {
    out += rewrite(text.slice(last, m.index)) + m[0];
    last = (m.index ?? 0) + m[0].length;
  }
  out += rewrite(text.slice(last));
  return { text: out, count };
}

/** Root-relative paths of the Markdown files that can hold links or citekey references. */
export function markdownFiles(lib: Library): string[] {
  const out: string[] = [];
  const ls = (dir: string): import("node:fs").Dirent[] => {
    try {
      return readdirSync(join(lib.root, ...dir.split("/")), { withFileTypes: true });
    } catch {
      return [];
    }
  };
  for (const item of ls("items")) {
    if (!item.isDirectory()) continue;
    for (const e of ls(`items/${item.name}`)) {
      if (e.isFile() && e.name.endsWith(".md")) out.push(`items/${item.name}/${e.name}`);
    }
    for (const e of ls(`items/${item.name}/cards`)) {
      if (e.isFile() && e.name.endsWith(".md")) out.push(`items/${item.name}/cards/${e.name}`);
    }
  }
  for (const e of ls("notes"))
    if (e.isFile() && e.name.endsWith(".md")) out.push(`notes/${e.name}`);
  for (const p of ls("projects")) {
    if (p.isDirectory() && existsSync(join(lib.root, "projects", p.name, "project.md"))) {
      out.push(`projects/${p.name}/project.md`);
    }
  }
  return out;
}

function walkFiles(lib: Library, rel: string, out: string[] = []): string[] {
  for (const e of readdirSync(join(lib.root, ...rel.split("/")), { withFileTypes: true })) {
    const child = `${rel}/${e.name}`;
    if (e.isDirectory()) walkFiles(lib, child, out);
    else out.push(child);
  }
  return out;
}

/**
 * Renames an item folder and its note, sets the new citekey and rewrites every wiki link to it
 * in items, cards, notes and projects, plus the `item` and `via` fields of cards.
 */
export function renameItem(
  lib: Library,
  actor: Actor,
  from: string,
  to: string,
): { rewritten: number } {
  loadItem(lib, from);
  if (from === to) return { rewritten: 0 };
  if (
    lib.index.get("SELECT 1 FROM items WHERE citekey = ?", to) ||
    existsSync(lib.paths.itemDir(to))
  ) {
    throw problem(
      "CITEKEY_TAKEN",
      `cannot rename ${from} to ${to}: that citekey is already used`,
      "Choose another citekey or rename the other item first.",
      { from, to },
    );
  }
  renameSync(lib.paths.itemDir(from), lib.paths.itemDir(to));
  renameSync(join(lib.paths.itemDir(to), `${from}.md`), join(lib.paths.itemDir(to), `${to}.md`));
  emitRemoved(lib, lib.indexer.removeUnder(`items/${from}`));

  let rewritten = 0;
  const own = `items/${to}/${to}.md`;
  for (const rel of markdownFiles(lib)) {
    const abs = lib.paths.abs(rel);
    const raw = readFileSync(abs, "utf8");
    const isOwn = rel === own;
    const isCard = /^items\/[^/]+\/cards\//.test(rel);
    let { text, count } = rewriteWikiLinks(raw, from, to);
    let changed = count > 0;
    if (isOwn || isCard) {
      const file = MarkdownFile.parse(text);
      const data = file.data;
      const patch: Record<string, unknown> = {};
      if (isOwn) patch.citekey = to;
      if (isCard && data?.item === from) patch.item = to;
      if (isCard && data?.via === from) patch.via = to;
      if (Object.keys(patch).length > 0) {
        file.patch(patch);
        if (isOwn) file.patch({ modified: lib.stamp(actor) });
        text = file.toString();
        changed = true;
      }
    }
    if (!changed) continue;
    lib.writeFile(rel, text);
    if (!isOwn) rewritten++;
  }
  for (const rel of walkFiles(lib, `items/${to}`)) lib.indexer.indexFile(rel);
  return { rewritten };
}
