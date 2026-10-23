// Fixture document for the reader tests: a small generated PDF (Helvetica text, page labels 9 to 11)
// and the matching blocks and doc.html, as the converter would deliver them.
import { buildBlockStream } from "@citegeist/anchoring";
import type { Block } from "@citegeist/schema";

export interface FixturePara {
  id: string;
  type: "heading" | "paragraph";
  /** visual lines as printed, with end-of-line hyphens */
  lines: string[];
}

/** Pages of paragraphs. Page index is the array index; printed labels start at 9. */
export const FIXTURE_PAGES: FixturePara[][] = [
  [
    { id: "bhead0001", type: "heading", lines: ["Systems and Observation"] },
    {
      id: "bpara0001",
      type: "paragraph",
      lines: [
        "Communication is the elementary operation of social systems and it cannot",
        "be reduced to individual action. Every observation presupposes a distinc-",
        "tion, and every distinction has a marked side that the observer cannot",
        "see while using it.",
      ],
    },
    {
      id: "bpara0002",
      type: "paragraph",
      lines: [
        "A system differentiates itself from its environment by operative closure.",
        "Closure does not mean isolation, since the system stays open to irritation.",
      ],
    },
  ],
  [
    {
      id: "bpara0003",
      type: "paragraph",
      lines: [
        "Meaning is the medium in which psychic and social systems reproduce them-",
        "selves. Every actualisation of meaning points to further possibilities that",
        "remain accessible but are not yet realised in the present operation.",
      ],
    },
    {
      id: "bpara0004",
      type: "paragraph",
      lines: [
        "The unity of the three selections of information, utterance and understanding",
        "is not given in advance but emerges only in the act of communication itself.",
      ],
    },
  ],
  [
    {
      id: "bpara0005",
      type: "paragraph",
      lines: [
        "Structures are expectations that condense in the course of communication and",
        "reduce the complexity from which the next operation can select.",
      ],
    },
  ],
];

export const FIXTURE_LABELS = ["9", "10", "11"];
export const FIXTURE_SOURCE = "3f9a1c2e7b4d";

function joinLines(lines: string[]): string {
  let text = "";
  for (const l of lines) {
    if (text === "") text = l;
    else if (/\p{L}-$/u.test(text) && /^\p{Ll}/u.test(l)) text = text.slice(0, -1) + l;
    else text = `${text} ${l}`;
  }
  return text;
}

export function fixtureBlocks(): Block[] {
  return FIXTURE_PAGES.flatMap((paras, page) =>
    paras.map((p): Block => {
      const text = joinLines(p.lines);
      return {
        id: p.id,
        type: p.type,
        flow: "body",
        text,
        spans: [{ page, label: FIXTURE_LABELS[page] ?? null, start: 0, end: text.length }],
        src: { engine: "fixture" },
      };
    }),
  );
}

export function fixtureStream() {
  return buildBlockStream(fixtureBlocks());
}

/** doc.html: one section per page with data-page and data-label, block ids as element ids. */
export function fixtureHtml(): string {
  const byId = new Map(fixtureBlocks().map((b) => [b.id, b]));
  return FIXTURE_PAGES.map((paras, page) => {
    const inner = paras
      .map((p) => {
        const tag = p.type === "heading" ? "h2" : "p";
        const text = byId.get(p.id)?.text ?? "";
        return `<${tag} id="${p.id}">${text}</${tag}>`;
      })
      .join("\n");
    return `<section data-page="${page}" data-label="${FIXTURE_LABELS[page]}">\n${inner}\n</section>`;
  }).join("\n");
}

const esc = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`);

/** A valid PDF with the fixture text in Helvetica, one line per text show operation. */
export function fixturePdf(): Uint8Array {
  const objs: string[] = [];
  const add = (body: string) => objs.push(body);
  const nPages = FIXTURE_PAGES.length;
  // object numbers: 1 catalog, 2 pages, 3 font, then page i at 4 + 2i and its content at 5 + 2i
  add(
    `<< /Type /Catalog /Pages 2 0 R /PageLabels << /Nums [0 << /S /D /St ${FIXTURE_LABELS[0]} >>] >> >>`,
  );
  add(
    `<< /Type /Pages /Count ${nPages} /Kids [${FIXTURE_PAGES.map((_, i) => `${4 + 2 * i} 0 R`).join(" ")}] >>`,
  );
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  FIXTURE_PAGES.forEach((paras, i) => {
    add(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + 2 * i} 0 R >>`,
    );
    let y = 720;
    let content = "";
    for (const p of paras) {
      const size = p.type === "heading" ? 16 : 11;
      for (const line of p.lines) {
        content += `BT /F1 ${size} Tf 1 0 0 1 72 ${y} Tm (${esc(line)}) Tj ET\n`;
        y -= size + 5;
      }
      y -= 10;
    }
    add(`<< /Length ${content.length} >>\nstream\n${content}endstream`);
  });
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}
