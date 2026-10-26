import { existsSync, readdirSync, readFileSync } from "node:fs";
import { Block, Pages } from "@citegeist/schema";
import { problem } from "./ingest/items.js";
import type { Library } from "./library.js";

export interface AssetsInput {
  citekey: string;
  source?: string | undefined;
}

export interface AssetsResult {
  source: string;
  kind: string;
  pdfUrl?: string;
  html?: string;
  blocks: Block[];
  pages?: Pages;
  paginated: boolean;
}

/** File name below `sources/` that belongs to a source hash, whatever its extension. */
function sourceFileName(lib: Library, citekey: string, hash: string): string | undefined {
  try {
    return readdirSync(lib.paths.sourcesDir(citekey)).find((f) => f.startsWith(`${hash}.`));
  } catch {
    return undefined;
  }
}

function readBlocks(path: string): Block[] {
  if (!existsSync(path)) return [];
  const blocks: Block[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const b = Block.safeParse(JSON.parse(line));
      if (b.success) blocks.push(b.data);
    } catch {
      // a broken line is skipped, the rest of the document stays readable
    }
  }
  return blocks;
}

function readPages(path: string): Pages | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const p = Pages.safeParse(JSON.parse(readFileSync(path, "utf8")));
    return p.success ? p.data : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Everything the reader needs for one source of an item. Without `source` the main source that
 * has converted blocks wins, then any main source, then the first one. The PDF itself is not
 * inlined: `pdfUrl` is a path on the core's HTTP server (`/files/<citekey>/sources/<hash>.pdf`).
 */
export function documentAssets(lib: Library, input: AssetsInput): AssetsResult {
  const { citekey } = input;
  const { frontmatter } = lib.getItem(citekey);
  const sources = frontmatter.sources;
  if (sources.length === 0) {
    throw problem(
      "NO_SOURCE",
      `item ${citekey} has no source file`,
      "Add a PDF to the item first.",
      { citekey },
      "do-first",
    );
  }
  const converted = (hash: string) => existsSync(lib.paths.blocks(citekey, hash));
  const source = input.source
    ? sources.find((s) => s.hash === input.source)
    : (sources.find((s) => s.role === "main" && converted(s.hash)) ??
      sources.find((s) => converted(s.hash)) ??
      sources.find((s) => s.role === "main") ??
      sources[0]);
  if (!source) {
    throw problem(
      "SOURCE_NOT_FOUND",
      `item ${citekey} has no source ${input.source}`,
      "Call items.get to list the sources of the item.",
      { citekey, source: input.source ?? null },
    );
  }
  const hash = source.hash;
  const file = sourceFileName(lib, citekey, hash);
  const htmlPath = lib.paths.docHtml(citekey, hash);
  const pages = readPages(lib.paths.pages(citekey, hash));
  return {
    source: hash,
    kind: source.kind,
    ...(source.kind === "pdf" && file
      ? { pdfUrl: `/files/${encodeURIComponent(citekey)}/sources/${encodeURIComponent(file)}` }
      : {}),
    ...(existsSync(htmlPath) ? { html: readFileSync(htmlPath, "utf8") } : {}),
    blocks: readBlocks(lib.paths.blocks(citekey, hash)),
    ...(pages ? { pages } : {}),
    paginated: !lib.derived.isUnpaginated(citekey, source),
  };
}
