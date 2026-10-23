import { existsSync, readFileSync, statSync } from "node:fs";
import { buildBlockStream, type TextStream } from "@citegeist/anchoring";
import { Block, Pages } from "@citegeist/schema";
import type { LibraryPaths } from "../paths.js";

interface Cached<T> {
  sig: string;
  value: T;
}

function signature(file: string): string | undefined {
  if (!existsSync(file)) return undefined;
  const st = statSync(file);
  return `${st.mtimeMs}:${st.size}`;
}

/**
 * Reads the derived files of a converted source (blocks.jsonl, pages.json) and keeps parsed
 * results until the file changes, so creating a card does not re-parse a whole book every time.
 */
export class DerivedStore {
  private readonly blockCache = new Map<string, Cached<{ blocks: Block[]; stream: TextStream }>>();
  private readonly pagesCache = new Map<string, Cached<Pages | undefined>>();

  constructor(private readonly paths: LibraryPaths) {}

  /** Drops cached pages.json content after this process rewrote the file. */
  forgetPages(citekey: string, hash: string): void {
    this.pagesCache.delete(this.paths.pages(citekey, hash));
  }

  hasBlocks(citekey: string, hash: string): boolean {
    return existsSync(this.paths.blocks(citekey, hash));
  }

  blocks(citekey: string, hash: string): { blocks: Block[]; stream: TextStream } | undefined {
    const file = this.paths.blocks(citekey, hash);
    const sig = signature(file);
    if (!sig) return undefined;
    const hit = this.blockCache.get(file);
    if (hit && hit.sig === sig) return hit.value;
    const blocks: Block[] = [];
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (line.trim() === "") continue;
      try {
        const r = Block.safeParse(JSON.parse(line));
        if (r.success) blocks.push(r.data);
      } catch {
        // a damaged line is skipped, the rest of the document stays usable
      }
    }
    const value = { blocks, stream: buildBlockStream(blocks) };
    this.blockCache.set(file, { sig, value });
    return value;
  }

  pages(citekey: string, hash: string): Pages | undefined {
    const file = this.paths.pages(citekey, hash);
    const sig = signature(file);
    if (!sig) return undefined;
    const hit = this.pagesCache.get(file);
    if (hit && hit.sig === sig) return hit.value;
    let value: Pages | undefined;
    try {
      const r = Pages.safeParse(JSON.parse(readFileSync(file, "utf8")));
      value = r.success ? r.data : undefined;
    } catch {
      value = undefined;
    }
    this.pagesCache.set(file, { sig, value });
    return value;
  }
}
