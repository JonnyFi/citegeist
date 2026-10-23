/**
 * A small valid PDF whose text matches the blocks of the core's stub conversion worker
 * (packages/core/src/ingest/stub-worker.mjs): three pages, each with a heading and two paragraphs.
 * Written by hand so the end-to-end test needs no download and no native module.
 */

const SECTIONS = ["Introduction", "Methods", "Results"] as const;

/** The text of paragraph `n` (1 or 2) in section `index`, as the stub worker writes it. */
export function paragraph(index: number, n: 1 | 2): string {
  return `Paragraph ${n} of ${SECTIONS[index]} on printed page ${index + 10}.`;
}

export function fixturePdf(): Buffer {
  const pages = SECTIONS.map((title, i) => [title, paragraph(i, 1), paragraph(i, 2)]);
  const esc = (s: string): string => s.replace(/[\\()]/g, (c) => `\\${c}`);
  const objects: string[] = [];
  const pageIds = pages.map((_, i) => 4 + i * 2);
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  pages.forEach((lines, i) => {
    const pageId = 4 + i * 2;
    const contentId = pageId + 1;
    const body = `BT /F1 14 Tf 72 720 Td ${lines
      .map((l, n) => `${n === 0 ? "" : "0 -30 Td "}(${esc(l)}) Tj`)
      .join(" ")} ET`;
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId] =
      `<< /Length ${Buffer.byteLength(body, "latin1")} >>\nstream\n${body}\nendstream`;
  });
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = Buffer.byteLength(out, "latin1");
    out += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) {
    out += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  }
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}
