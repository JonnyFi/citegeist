import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, resolve } from "node:path";
import { type ItemDraft, parseBibtex, parseCslJson, parseRis } from "@citegeist/cite";
import { normalizeDoi } from "@citegeist/metadata";
import type { ImportSource } from "@citegeist/ops";
import { CitegeistError } from "@citegeist/schema";
import type {
  ImportOptions,
  ImportProblem,
  SourceAttachment,
  SourceBundle,
  SourceItem,
} from "./types.js";
import { normalizeText } from "./util.js";

type FileSource = Extract<ImportSource, { kind: "bibtex" | "ris" | "csl-json" }>;

export interface GenericDeps {
  /**
   * Reads the DOI from the first pages of a PDF. Used for PDFs that no file name or title
   * matches. The core's extractPdfText with extractIdentifiers does this.
   */
  pdfDoi?: ((path: string) => Promise<string | undefined>) | undefined;
}

function sourceError(code: string, message: string, fix: string, context: Record<string, unknown>) {
  return new CitegeistError({ code, message, fix, recovery: "fix-and-retry", context });
}

/** Paths from the `file` fields of BibTeX entries (Zotero, JabRef and Mendeley write them). */
export function extractBibFiles(text: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const entry = /@[A-Za-z]+\s*[{(]\s*([^,\s]+)\s*,/g;
  const starts = [...text.matchAll(entry)];
  starts.forEach((m, i) => {
    const key = m[1] ?? "";
    const end = starts[i + 1]?.index ?? text.length;
    const body = text.slice(m.index ?? 0, end);
    const f = /\bfile\s*=\s*(?:\{((?:[^{}]|\{[^{}]*\})*)\}|"([^"]*)")/i.exec(body);
    const raw = f?.[1] ?? f?.[2];
    if (!raw) return;
    const paths: string[] = [];
    for (const part of raw.split(/(?<!\\);/)) {
      const fields = part.split(/(?<!\\):/).map((s) => s.replace(/\\([:;\\])/g, "$1").trim());
      // "Title:path:type", ":path:type" or just "path".
      const candidate = fields.length === 1 ? fields[0] : fields[1] || fields[0];
      if (candidate && /\.(pdf|epub|html?)$/i.test(candidate)) paths.push(candidate);
    }
    if (paths.length > 0) out.set(key, paths);
  });
  return out;
}

function listPdfs(folder: string, problems: ImportProblem[]): string[] {
  const out: string[] = [];
  const walk = (dir: string, depth: number): void => {
    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const p = join(dir, e.name);
      if (e.isDirectory() && depth < 8) walk(p, depth + 1);
      else if (e.isFile() && extname(e.name).toLowerCase() === ".pdf") out.push(p);
    }
  };
  if (!existsSync(folder) || !statSync(folder).isDirectory()) {
    problems.push({
      code: "PDF_FOLDER_NOT_FOUND",
      severity: "error",
      message: `PDF folder ${folder} does not exist`,
    });
    return out;
  }
  walk(folder, 0);
  return out.sort();
}

function doiKey(doi: string): string {
  return (
    normalizeDoi(doi)
      ?.toLowerCase()
      .replace(/[^a-z0-9]+/g, "") ?? ""
  );
}

interface Candidate {
  path: string;
  norm: string;
  squashed: string;
}

/**
 * Assigns each PDF to at most one entry. Order of tries per entry: file name equals the citekey,
 * the file name holds the DOI, file name and title agree. PDFs left over are asked for their DOI.
 */
export async function matchPdfs(
  drafts: readonly { ref: string; draft: ItemDraft }[],
  pdfs: readonly string[],
  deps: GenericDeps,
): Promise<{ matches: Map<string, string>; unmatched: string[] }> {
  const candidates: Candidate[] = pdfs.map((path) => {
    const stem = basename(path, extname(path));
    return {
      path,
      norm: normalizeText(stem),
      squashed: stem.toLowerCase().replace(/[^a-z0-9]+/g, ""),
    };
  });
  const used = new Set<string>();
  const matches = new Map<string, string>();
  const take = (ref: string, c: Candidate | undefined): void => {
    if (!c || used.has(c.path) || matches.has(ref)) return;
    used.add(c.path);
    matches.set(ref, c.path);
  };
  const free = () => candidates.filter((c) => !used.has(c.path));

  for (const { ref, draft } of drafts) {
    const key = typeof draft.citekey === "string" ? draft.citekey.toLowerCase() : "";
    if (key.length >= 3)
      take(
        ref,
        free().find((c) => c.squashed === key.replace(/[^a-z0-9]+/g, "")),
      );
  }
  for (const { ref, draft } of drafts) {
    if (matches.has(ref) || typeof draft.DOI !== "string") continue;
    const doi = doiKey(draft.DOI);
    if (doi.length >= 8)
      take(
        ref,
        free().find((c) => c.squashed.includes(doi)),
      );
  }
  for (const { ref, draft } of drafts) {
    if (matches.has(ref)) continue;
    const title = normalizeText(draft.title);
    if (title.length < 6) continue;
    take(
      ref,
      free().find(
        (c) =>
          c.norm === title ||
          (title.length >= 15 && c.norm.includes(title)) ||
          (c.norm.length >= 15 && title.startsWith(c.norm)),
      ),
    );
  }
  if (deps.pdfDoi) {
    const byDoi = new Map<string, string>();
    for (const { ref, draft } of drafts) {
      if (!matches.has(ref) && typeof draft.DOI === "string") byDoi.set(doiKey(draft.DOI), ref);
    }
    if (byDoi.size > 0) {
      for (const c of free()) {
        const found = await deps.pdfDoi(c.path).catch(() => undefined);
        const ref = found ? byDoi.get(doiKey(found)) : undefined;
        if (ref) take(ref, c);
      }
    }
  }
  return { matches, unmatched: free().map((c) => c.path) };
}

function pdfAttachment(path: string): SourceAttachment {
  return {
    ref: `file:${basename(path)}`,
    filename: basename(path),
    contentType: "application/pdf",
    linkMode: "imported_file",
    path,
    annotations: [],
  };
}

/** Reads a BibTeX, BibLaTeX, RIS or CSL-JSON file into entries, with PDFs from an optional folder. */
export async function bundleFromFile(
  source: FileSource,
  options: Pick<ImportOptions, "attachments">,
  deps: GenericDeps = {},
): Promise<SourceBundle> {
  const path = resolve(source.path);
  if (!existsSync(path) || !statSync(path).isFile()) {
    throw sourceError(
      "IMPORT_SOURCE_NOT_FOUND",
      `file ${path} does not exist`,
      "Pass the path of an existing .bib, .ris or .json file.",
      { path },
    );
  }
  const text = readFileSync(path, "utf8").replace(/^﻿/, "");
  const problems: ImportProblem[] = [];
  let drafts: ItemDraft[];
  let errors: string[] = [];
  let code: string;
  if (source.kind === "bibtex") {
    const r = parseBibtex(text);
    drafts = r.items;
    errors = r.errors;
    code = "BIBTEX_ENTRY_INVALID";
  } else if (source.kind === "ris") {
    const r = parseRis(text);
    drafts = r.items;
    errors = r.errors;
    code = "RIS_RECORD_INVALID";
  } else {
    code = "CSL_ITEM_INVALID";
    try {
      drafts = parseCslJson(text);
    } catch (err) {
      throw sourceError(
        "IMPORT_SOURCE_INVALID",
        `${basename(path)} is not valid CSL-JSON: ${(err as Error).message}`,
        "Export the library as CSL JSON and pass that file.",
        { path },
      );
    }
  }
  for (const message of errors) problems.push({ code, severity: "warning", message });
  if (drafts.length === 0 && errors.length === 0) {
    problems.push({
      code: "SOURCE_EMPTY",
      severity: "warning",
      message: `${basename(path)} holds no entries`,
    });
  }

  const items: SourceItem[] = drafts.map((draft, i) => ({
    ref: typeof draft.citekey === "string" && draft.citekey !== "" ? draft.citekey : `#${i + 1}`,
    draft,
    collections: [],
    notes: [],
    attachments: [],
  }));
  // Entries that share a key would clash as refs; make refs unique.
  const seen = new Map<string, number>();
  for (const item of items) {
    const n = (seen.get(item.ref) ?? 0) + 1;
    seen.set(item.ref, n);
    if (n > 1) item.ref = `${item.ref}#${n}`;
  }

  if (options.attachments) {
    const base = dirname(path);
    const claimed = new Set<string>();
    if (source.kind === "bibtex") {
      const files = extractBibFiles(text);
      for (const item of items) {
        const listed = files.get(item.ref.replace(/#\d+$/, "")) ?? [];
        for (const f of listed) {
          const abs = isAbsolute(f) ? f : resolve(base, f);
          if (existsSync(abs)) {
            if (!claimed.has(abs)) {
              claimed.add(abs);
              item.attachments.push(pdfAttachment(abs));
            }
          } else {
            problems.push({
              code: "ATTACHMENT_FILE_MISSING",
              severity: "warning",
              message: `file listed for ${item.ref} not found: ${abs}`,
              ref: item.ref,
            });
          }
        }
      }
    }
    if (source.pdfFolder) {
      const pdfs = listPdfs(resolve(source.pdfFolder), problems).filter((p) => !claimed.has(p));
      const pending = items.filter((i) => i.attachments.length === 0);
      const { matches, unmatched } = await matchPdfs(pending, pdfs, deps);
      for (const item of pending) {
        const p = matches.get(item.ref);
        if (p) item.attachments.push(pdfAttachment(p));
      }
      if (unmatched.length > 0) {
        const shown = unmatched.slice(0, 5).map((p) => basename(p));
        problems.push({
          code: "PDF_UNMATCHED",
          severity: "info",
          message: `${unmatched.length} PDF${unmatched.length === 1 ? "" : "s"} in the folder matched no entry: ${shown.join(", ")}${unmatched.length > shown.length ? ", ..." : ""}`,
        });
      }
    }
  }

  const labels = { bibtex: "BibTeX", ris: "RIS", "csl-json": "CSL-JSON" } as const;
  return {
    label: `${labels[source.kind]} (${basename(path)})`,
    tag: source.kind,
    items,
    standaloneNotes: [],
    collections: [],
    problems,
    filesChecked: true,
  };
}
