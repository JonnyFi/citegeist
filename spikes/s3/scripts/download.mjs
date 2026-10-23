// Downloads the three arXiv PDFs used by the spike into spikes/s3/data/ (gitignored).
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
const papers = [
  ['attention', '1706.03762'], // Attention Is All You Need: two columns, tables, math
  ['bert', '1810.04805'], // BERT: two columns, many tables, footnotes
  ['adam', '1412.6980'], // Adam: heavy math, algorithm boxes
];

await mkdir(dir, { recursive: true });
for (const [name, id] of papers) {
  const file = path.join(dir, `${name}.pdf`);
  try {
    await stat(file);
    console.log(`have ${name}.pdf`);
    continue;
  } catch {}
  const res = await fetch(`https://arxiv.org/pdf/${id}`);
  if (!res.ok) throw new Error(`${id}: HTTP ${res.status}`);
  await writeFile(file, Buffer.from(await res.arrayBuffer()));
  console.log(`downloaded ${name}.pdf`);
  await new Promise((r) => setTimeout(r, 3000)); // be polite to arXiv
}
