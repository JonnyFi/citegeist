import { buildStream, type StreamUnit, type TextStream, toSource } from "@citegeist/anchoring";

const BLOCK_ID = /^b[0-9a-z]{6,12}$/;

export interface DomStream {
  stream: TextStream;
  /** every text node with its offset in the concatenation of all text nodes (source space) */
  nodes: { node: Text; start: number }[];
}

interface Owner {
  id: string | undefined;
  page: number | undefined;
  label: string | null;
}

function ownerOf(node: Node, root: HTMLElement): Owner {
  let id: string | undefined;
  let pageEl: HTMLElement | undefined;
  for (let el = node.parentElement; el && el !== root; el = el.parentElement) {
    if (!id && BLOCK_ID.test(el.id)) id = el.id;
    if (!pageEl && el.dataset.page !== undefined) pageEl = el;
    if (id && pageEl) break;
  }
  const page = pageEl ? Number(pageEl.dataset.page) : undefined;
  return {
    id,
    page: page !== undefined && Number.isFinite(page) ? page : undefined,
    label: pageEl?.dataset.label ?? null,
  };
}

/**
 * Text stream of a rendered `doc.html`. Block elements are found by their id, pages by
 * `data-page` and `data-label`. The origin map points at text node offsets.
 */
export function buildDomStream(root: HTMLElement): DomStream {
  const nodes: DomStream["nodes"] = [];
  const units: StreamUnit[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let total = 0;
  let current: { owner: Owner; text: string; base: number } | null = null;
  const flush = () => {
    if (!current) return;
    const { owner, text, base } = current;
    const spans =
      owner.page !== undefined
        ? [{ page: owner.page, label: owner.label, start: 0, end: text.length }]
        : [];
    units.push({ id: owner.id, text, srcBase: base, spans });
    current = null;
  };
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const node = n as Text;
    if (node.parentElement?.closest("script,style")) continue;
    nodes.push({ node, start: total });
    const owner = ownerOf(node, root);
    if (current && (current.owner.id !== owner.id || current.owner.page !== owner.page)) flush();
    if (!current) current = { owner, text: "", base: total };
    current.text += node.data;
    total += node.data.length;
  }
  flush();
  return { stream: buildStream(units), nodes };
}

/** Source-space range covered by a DOM range, from the first to the last text node it touches. */
export function sourceRangeOfDomRange(
  ds: DomStream,
  range: Range,
): { start: number; end: number } | null {
  let start = -1;
  let end = -1;
  for (const { node, start: base } of ds.nodes) {
    if (!range.intersectsNode(node)) continue;
    const a = node === range.startContainer ? range.startOffset : 0;
    const b = node === range.endContainer ? range.endOffset : node.data.length;
    if (b <= a) continue;
    if (start === -1) start = base + a;
    end = base + b;
  }
  return start === -1 ? null : { start, end };
}

/** One DOM range per text node covering the stream range [start, end). */
export function domRangesOfStreamRange(ds: DomStream, start: number, end: number): Range[] {
  const src = toSource(ds.stream, start, end);
  if (!src) return [];
  const out: Range[] = [];
  for (const { node, start: base } of ds.nodes) {
    const a = Math.max(src.start, base) - base;
    const b = Math.min(src.end, base + node.data.length) - base;
    if (b <= a) continue;
    const r = document.createRange();
    r.setStart(node, a);
    r.setEnd(node, b);
    out.push(r);
  }
  return out;
}
