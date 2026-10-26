/**
 * Line based three-way merge for undoing an agent turn. `base` is the text the agent produced,
 * `ours` is what the file contains now (possibly edited by the user since) and `theirs` is the text
 * from before the turn. The result applies "base to theirs" on top of `ours`. Changes that touch
 * the same lines, or lines right next to each other, are reported as a conflict.
 */
export type MergeResult = { ok: true; text: string } | { ok: false; reason: string };

interface Hunk {
  /** First base line replaced. */
  start: number;
  /** One past the last base line replaced. */
  end: number;
  lines: string[];
}

/** Cells of the LCS table that the merge is willing to compute. */
const MAX_CELLS = 16_000_000;

/** Edits that turn `base` into `other`, as replacements of base line ranges. */
function hunks(base: string[], other: string[]): Hunk[] | undefined {
  let head = 0;
  while (head < base.length && head < other.length && base[head] === other[head]) head++;
  let tail = 0;
  while (
    tail < base.length - head &&
    tail < other.length - head &&
    base[base.length - 1 - tail] === other[other.length - 1 - tail]
  ) {
    tail++;
  }
  const a = base.slice(head, base.length - tail);
  const b = other.slice(head, other.length - tail);
  if (a.length === 0 && b.length === 0) return [];
  if (a.length === 0 || b.length === 0) return [{ start: head, end: head + a.length, lines: b }];
  if ((a.length + 1) * (b.length + 1) > MAX_CELLS) return undefined;

  const w = b.length + 1;
  const lcs = new Uint32Array((a.length + 1) * w);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i * w + j] =
        a[i] === b[j]
          ? (lcs[(i + 1) * w + j + 1] ?? 0) + 1
          : Math.max(lcs[(i + 1) * w + j] ?? 0, lcs[i * w + j + 1] ?? 0);
    }
  }

  const out: Hunk[] = [];
  let i = 0;
  let j = 0;
  let open: Hunk | undefined;
  const close = () => {
    if (open) out.push(open);
    open = undefined;
  };
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      close();
      i++;
      j++;
    } else if (
      j >= b.length ||
      (i < a.length && (lcs[(i + 1) * w + j] ?? 0) >= (lcs[i * w + j + 1] ?? 0))
    ) {
      open ??= { start: head + i, end: head + i, lines: [] };
      open.end = head + i + 1;
      i++;
    } else {
      open ??= { start: head + i, end: head + i, lines: [] };
      open.lines.push(b[j] as string);
      j++;
    }
  }
  close();
  return out;
}

const touches = (x: Hunk, y: Hunk): boolean => x.start <= y.end && y.start <= x.end;
const same = (x: Hunk, y: Hunk): boolean =>
  x.start === y.start &&
  x.end === y.end &&
  x.lines.length === y.lines.length &&
  x.lines.every((l, k) => l === y.lines[k]);

export function merge3(base: string, ours: string, theirs: string): MergeResult {
  if (ours === base) return { ok: true, text: theirs };
  if (theirs === base || ours === theirs) return { ok: true, text: ours };
  const baseLines = base.split("\n");
  const mine = hunks(baseLines, ours.split("\n"));
  const other = hunks(baseLines, theirs.split("\n"));
  if (!mine || !other) return { ok: false, reason: "the file is too different to merge" };

  const out: string[] = [];
  let pos = 0;
  let i = 0;
  let j = 0;
  while (i < mine.length || j < other.length) {
    const a = mine[i];
    const b = other[j];
    let take: Hunk;
    if (a && b && touches(a, b)) {
      if (!same(a, b)) return { ok: false, reason: "the same lines changed since the turn" };
      take = a;
      i++;
      j++;
    } else if (a && (!b || a.start <= b.start)) {
      take = a;
      i++;
    } else {
      take = b as Hunk;
      j++;
    }
    out.push(...baseLines.slice(pos, take.start), ...take.lines);
    pos = take.end;
  }
  out.push(...baseLines.slice(pos));
  return { ok: true, text: out.join("\n") };
}
