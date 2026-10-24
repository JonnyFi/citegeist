/** Headings kept in a path, nearest first dropped last: "3 Methods > 3.2 Sampling". */
const MAX_DEPTH = 4;
/** A heading longer than this is cut; a "heading" of that size is usually a mis-tagged paragraph. */
const MAX_HEADING_CHARS = 120;
const SEPARATOR = " > ";

interface Open {
  depth: number;
  text: string;
  numbered: boolean;
}

export interface HeadingBlock {
  type: string;
  /** Outline number of the enclosing section as the converter wrote it ("3.2"). */
  sec: string | null;
  text: string;
}

/**
 * Walks the blocks of one document in reading order and gives each block the path of the
 * headings it sits under, like Docling's `contextualize`. The converter numbers sections by
 * counting, and for many PDFs every heading comes out at the top level; the printed number in
 * the heading text ("3.2 AI models") and the outline number are used to recover the nesting.
 * A heading without a number that follows a numbered subsection is taken as its child.
 */
export class HeadingTracker {
  private stack: Open[] = [];

  /** Call for every body block in order; returns the path of the block ("" before any heading). */
  next(block: HeadingBlock): string {
    if (block.type === "heading" && block.sec) {
      const text = block.text.replace(/\s+/g, " ").trim().slice(0, MAX_HEADING_CHARS);
      if (text) this.open(text, block.sec);
    }
    return this.stack
      .slice(-MAX_DEPTH)
      .map((h) => h.text)
      .join(SEPARATOR);
  }

  private open(text: string, sec: string): void {
    const printed = /^((?:\d+\.)*\d+)\.?\s/.exec(text)?.[1];
    const top = this.stack[this.stack.length - 1];
    let depth: number;
    if (printed) depth = printed.split(".").length;
    else if (sec.includes(".")) depth = sec.split(".").length;
    else if (top?.numbered && top.depth >= 2) depth = top.depth + 1;
    else depth = 1;
    while (this.stack.length > 0 && (this.stack[this.stack.length - 1] as Open).depth >= depth) {
      this.stack.pop();
    }
    this.stack.push({ depth, text, numbered: printed !== undefined });
  }
}
