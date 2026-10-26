import type { Block, Pages } from "@citegeist/schema";

/**
 * A small converted document for the mock core: what the real core would hold under
 * derived/<hash>/ (blocks, pages, doc.html) plus a generated PDF with the same text. The text of
 * the fixture cards sits inside the paragraphs, so their highlights resolve in both views.
 */
export interface MockPara {
  id: string;
  type: "heading" | "paragraph";
  text: string;
}

export interface MockPage {
  label: string;
  paras: MockPara[];
}

export const LUHMANN_PAGES: MockPage[] = [
  {
    label: "31",
    paras: [
      { id: "bhead0001", type: "heading", text: "Kapitel 2: Soziale Systeme und Kommunikation" },
      {
        id: "bpara0001",
        type: "paragraph",
        text: "Soziale Systeme bestehen aus Kommunikationen und nur aus Kommunikationen. Menschen sind in ihrer Umwelt. Diese Unterscheidung ist der Ausgangspunkt der folgenden Ueberlegungen und wird nicht als Abwertung des Menschen verstanden.",
      },
      {
        id: "bpara0002",
        type: "paragraph",
        text: "Wer Kommunikation beobachtet, beobachtet immer schon eine Operation, die sich an frueheren Operationen orientiert und weitere Anschluesse erwartet.",
      },
    ],
  },
  {
    label: "58",
    paras: [
      {
        id: "bpara0003",
        type: "paragraph",
        text: "Es gibt selbstreferentielle Systeme. Der Begriff der Selbstreferenz bezeichnet die Einheit, die ein Element, ein Prozess, ein System fuer sich selbst ist. Er bezieht sich nicht auf eine Eigenschaft, sondern auf eine Operation.",
      },
      {
        id: "bpara0004",
        type: "paragraph",
        text: "Die Selbstbeschreibung eines Systems bleibt dabei stets ein Teil des Systems, das sie beschreibt.",
      },
    ],
  },
  {
    label: "148",
    paras: [
      { id: "bhead0002", type: "heading", text: "Doppelte Kontingenz" },
      {
        id: "bpara0005",
        type: "paragraph",
        text: "Doppelte Kontingenz ist der Ausgangspunkt der Bildung sozialer Systeme. Zwei Beobachter koennen sich wechselseitig nicht durchschauen und muessen trotzdem anschlussfaehig handeln.",
      },
      {
        id: "bpara0006",
        type: "paragraph",
        text: "Aus diesem Problem entstehen Erwartungen, die sich im Lauf der Kommunikation verdichten und das naechste Verhalten vorstrukturieren.",
      },
    ],
  },
];

/** The English edition of the same pages, served when the mock library runs in English. */
export const LUHMANN_PAGES_EN: MockPage[] = [
  {
    label: "31",
    paras: [
      { id: "bhead0001", type: "heading", text: "Chapter 2: Social Systems and Communication" },
      {
        id: "bpara0001",
        type: "paragraph",
        text: "Social systems consist of communications and only of communications. Human beings are in their environment. This distinction is the starting point of the considerations that follow and does not devalue human beings.",
      },
      {
        id: "bpara0002",
        type: "paragraph",
        text: "Whoever observes communication always observes an operation that orients itself toward earlier operations and expects further connections.",
      },
    ],
  },
  {
    label: "58",
    paras: [
      {
        id: "bpara0003",
        type: "paragraph",
        text: "There are self-referential systems. The concept of self-reference designates the unity that an element, a process, or a system is for itself. It refers not to a property but to an operation.",
      },
      {
        id: "bpara0004",
        type: "paragraph",
        text: "The self-description of a system always remains a part of the system that it describes.",
      },
    ],
  },
  {
    label: "148",
    paras: [
      { id: "bhead0002", type: "heading", text: "Double contingency" },
      {
        id: "bpara0005",
        type: "paragraph",
        text: "Double contingency is the starting point for the formation of social systems. Two observers cannot see through each other, and still they have to act in a way that allows further connection.",
      },
      {
        id: "bpara0006",
        type: "paragraph",
        text: "Out of this problem arise expectations that condense in the course of communication and pre-structure the next behavior.",
      },
    ],
  },
];

export function mockBlocks(pages: readonly MockPage[]): Block[] {
  return pages.flatMap((page, index) =>
    page.paras.map(
      (p): Block => ({
        id: p.id,
        type: p.type,
        flow: "body",
        text: p.text,
        spans: [{ page: index, label: page.label, start: 0, end: p.text.length }],
        src: { engine: "mock" },
      }),
    ),
  );
}

export function mockPages(pages: readonly MockPage[], source: string): Pages {
  return {
    source,
    confirmed: false,
    pages: pages.map((p, index) => ({
      index,
      label: p.label,
      labelSource: "pdf-pagelabels" as const,
      width: 612,
      height: 792,
      rotation: 0 as const,
      textSource: "born-digital" as const,
    })),
  };
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** doc.html: one section per page with data-page and data-label, block ids as element ids. */
export function mockHtml(pages: readonly MockPage[]): string {
  return pages
    .map((page, index) => {
      const inner = page.paras
        .map((p) => {
          const tag = p.type === "heading" ? "h2" : "p";
          return `<${tag} id="${p.id}">${escapeHtml(p.text)}</${tag}>`;
        })
        .join("\n");
      return `<section data-page="${index}" data-label="${page.label}">\n${inner}\n</section>`;
    })
    .join("\n");
}

/**
 * The same text as a converted web page: one placeholder page without a printed label, which is
 * what the worker writes for a source without pages.
 */
export function mockWebDoc(
  pages: readonly MockPage[],
  source: string,
): { html: string; blocks: Block[]; pages: Pages } {
  const paras = pages.flatMap((p) => p.paras);
  return {
    html: `<section data-page="0">\n${paras
      .map((p) => {
        const tag = p.type === "heading" ? "h2" : "p";
        return `<${tag} id="${p.id}">${escapeHtml(p.text)}</${tag}>`;
      })
      .join("\n")}\n</section>`,
    blocks: paras.map(
      (p): Block => ({
        id: p.id,
        type: p.type,
        flow: "body",
        text: p.text,
        spans: [{ page: 0, label: null, start: 0, end: p.text.length }],
        src: { engine: "mock" },
      }),
    ),
    pages: {
      source,
      confirmed: false,
      pages: [
        {
          index: 0,
          label: null,
          labelSource: "none",
          width: 612,
          height: 792,
          rotation: 0,
          textSource: "html",
          labelConfidence: 0,
        },
      ],
    },
  };
}

function wrap(text: string, max: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line !== "" && line.length + word.length + 1 > max) {
      lines.push(line);
      line = word;
    } else {
      line = line === "" ? word : `${line} ${word}`;
    }
  }
  if (line !== "") lines.push(line);
  return lines;
}

const esc = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`);

/** A valid PDF with the text in Helvetica, one line per text show operation, and page labels. */
export function mockPdf(pages: readonly MockPage[]): Uint8Array {
  const objs: string[] = [];
  const nums = pages.map((p, i) => `${i} << /S /D /St ${p.label} >>`).join(" ");
  // object numbers: 1 catalog, 2 pages, 3 font, then page i at 4 + 2i and its content at 5 + 2i
  objs.push(`<< /Type /Catalog /Pages 2 0 R /PageLabels << /Nums [${nums}] >> >>`);
  objs.push(
    `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${4 + 2 * i} 0 R`).join(" ")}] >>`,
  );
  objs.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  pages.forEach((page, i) => {
    objs.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + 2 * i} 0 R >>`,
    );
    let y = 720;
    let content = "";
    for (const p of page.paras) {
      const size = p.type === "heading" ? 16 : 11;
      for (const line of wrap(p.text, p.type === "heading" ? 60 : 82)) {
        content += `BT /F1 ${size} Tf 1 0 0 1 72 ${y} Tm (${esc(line)}) Tj ET\n`;
        y -= size + 5;
      }
      y -= 10;
    }
    objs.push(`<< /Length ${content.length} >>\nstream\n${content}endstream`);
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

export function toDataUrl(bytes: Uint8Array, mime: string): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return `data:${mime};base64,${btoa(binary)}`;
}
