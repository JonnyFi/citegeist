/** What an indexed library file is, derived from its root-relative path. */
export type FileKind = "manifest" | "item" | "card" | "note" | "project" | "blocks";

export type Classified =
  | { kind: FileKind; key: string; citekey?: string; source?: string }
  | { kind: "conflict"; original: string }
  | { kind: "placeholder"; original: string };

const KNOWN: { re: RegExp; kind: FileKind }[] = [
  { re: /^citegeist\.json$/, kind: "manifest" },
  { re: /^items\/([^/]+)\/([^/]+)\.md$/, kind: "item" },
  { re: /^items\/([^/]+)\/cards\/([^/]+)\.md$/, kind: "card" },
  { re: /^items\/([^/]+)\/derived\/([0-9a-f]{12})\/blocks\.jsonl$/, kind: "blocks" },
  { re: /^notes\/(?:concepts\/)?([^/]+)\.md$/, kind: "note" },
  { re: /^projects\/([^/]+)\/project\.md$/, kind: "project" },
];

/** iCloud conflict copies look like "name 2.md": the base name plus a space and a number. */
const CONFLICT = /^(.*\/)?([^/]+) (\d+)(\.[^./]+)$/;
/** iCloud placeholders of evicted files look like ".name.md.icloud". */
const PLACEHOLDER = /^(.*\/)?\.([^/]+)\.icloud$/;

function classifyKnown(rel: string): Classified | null {
  for (const { re, kind } of KNOWN) {
    const m = re.exec(rel);
    if (!m) continue;
    switch (kind) {
      case "manifest":
        return { kind, key: "manifest" };
      case "item": {
        const [, folder = "", name = ""] = m;
        return folder === name ? { kind, key: folder, citekey: folder } : null;
      }
      case "card":
        return { kind, key: m[2] ?? "", citekey: m[1] ?? "" };
      case "blocks":
        return { kind, key: `${m[1]}/${m[2]}`, citekey: m[1] ?? "", source: m[2] ?? "" };
      case "note":
        return { kind, key: m[1] ?? "" };
      case "project":
        return { kind, key: m[1] ?? "" };
    }
  }
  return null;
}

/** Classifies a root-relative path with forward slashes. Null means: not an indexed file. */
export function classify(
  rel: string,
  originalExists: (originalRel: string) => boolean = () => true,
): Classified | null {
  const c = CONFLICT.exec(rel);
  if (c) {
    const original = `${c[1] ?? ""}${c[2] ?? ""}${c[4] ?? ""}`;
    // "Kapitel 2.md" is only a conflict copy if "Kapitel.md" exists next to it.
    if (classifyKnown(original) && originalExists(original)) return { kind: "conflict", original };
  }
  const known = classifyKnown(rel);
  if (known) return known;
  const ph = PLACEHOLDER.exec(rel);
  if (ph) {
    const original = `${ph[1] ?? ""}${ph[2] ?? ""}`;
    return classifyKnown(original) ? { kind: "placeholder", original } : null;
  }
  return null;
}

/** Directories the scanner never descends into. */
export const SKIPPED_DIRS = new Set([
  "sources",
  "assets",
  "exports",
  "chats",
  "node_modules",
  ".git",
  ".obsidian",
  ".trash",
]);
