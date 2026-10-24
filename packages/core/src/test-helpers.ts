import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  type CardBody,
  CardFrontmatter,
  ItemFrontmatter,
  NoteFrontmatter,
  ProjectFrontmatter,
} from "@citegeist/schema";
import { serializeCardBody } from "./card-body.js";
import { MarkdownFile } from "./frontmatter.js";
import { quoteSha256 } from "./hash.js";
import { newCardId, newNoteId, ulid } from "./ids.js";

export const STAMP = { at: "2026-10-23T10:00:00.000Z", by: "human" } as const;

const dirs: string[] = [];

export function tmpDir(prefix = "citegeist-"): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
}

export function cleanTmpDirs(): void {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
}

/** Polls until `fn` returns a truthy value or the timeout passes. */
export async function until<T>(
  fn: () => T | Promise<T>,
  timeoutMs = 3000,
  stepMs = 10,
): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - start > timeoutMs) throw new Error(`condition not met within ${timeoutMs} ms`);
    await new Promise((r) => setTimeout(r, stepMs));
  }
}

export function itemData(
  citekey: string,
  extra: Record<string, unknown> = {},
): ReturnType<typeof ItemFrontmatter.parse> {
  return ItemFrontmatter.parse({
    id: ulid(),
    citekey,
    type: "book",
    title: `Title of ${citekey}`,
    author: [{ family: "Luhmann", given: "Niklas" }],
    issued: 1984,
    created: STAMP,
    ...extra,
  });
}

export function cardData(
  citekey: string,
  quote: string,
  extra: Record<string, unknown> = {},
): { fm: ReturnType<typeof CardFrontmatter.parse>; body: CardBody } {
  const fm = CardFrontmatter.parse({
    id: newCardId(),
    item: citekey,
    anchor: { text: { exact: quote } },
    quote_sha256: quoteSha256(quote),
    created: STAMP,
    ...extra,
  });
  return { fm, body: { quote, extra: [] } };
}

export function noteData(title: string, extra: Record<string, unknown> = {}) {
  return NoteFrontmatter.parse({ id: newNoteId(), title, created: STAMP, ...extra });
}

export function projectData(slug: string, extra: Record<string, unknown> = {}) {
  return ProjectFrontmatter.parse({ slug, title: `Project ${slug}`, created: STAMP, ...extra });
}

/** Writes a file straight to disk, bypassing the core (like an external editor would). */
export function writeRaw(root: string, rel: string, content: string): void {
  const abs = join(root, ...rel.split("/"));
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

export function itemFile(fm: ReturnType<typeof itemData>, body = ""): string {
  return MarkdownFile.create(fm as Record<string, unknown>, body).toString();
}

export function cardFile(card: { fm: ReturnType<typeof CardFrontmatter.parse>; body: CardBody }) {
  return MarkdownFile.create(
    card.fm as Record<string, unknown>,
    serializeCardBody(card.body),
  ).toString();
}

export function noteFile(fm: ReturnType<typeof noteData>, body = ""): string {
  return MarkdownFile.create(fm as Record<string, unknown>, body).toString();
}

const WORDS_DE = [
  "Kommunikation",
  "Gesellschaft",
  "System",
  "Beobachtung",
  "Differenz",
  "Autopoiesis",
  "Forschung",
  "Methode",
  "Theorie",
  "Quelle",
  "Bibliothek",
  "Wissenschaft",
  "Begriff",
  "Struktur",
  "Prozess",
  "Handlung",
];
const WORDS_EN = [
  "communication",
  "society",
  "system",
  "observation",
  "difference",
  "research",
  "method",
  "theory",
  "source",
  "library",
  "science",
  "concept",
  "structure",
  "process",
  "action",
  "learning",
];

function sentence(seed: number, words: number): string {
  const out: string[] = [];
  let s = seed * 2654435761;
  for (let i = 0; i < words; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const list = (s >> 4) % 2 === 0 ? WORDS_DE : WORDS_EN;
    out.push(list[(s >> 8) % list.length] ?? "word");
  }
  return `${out.join(" ")}.`;
}

/** Writes `count` synthetic items (each with a literature note and one card) straight to disk. */
export function writeSyntheticItems(root: string, count: number): void {
  for (let i = 0; i < count; i++) {
    const citekey = `syn${String(i).padStart(5, "0")}`;
    const fm = itemData(citekey, {
      title: `Synthetic ${i}: ${sentence(i, 4)}`,
      abstract: sentence(i + 7, 40),
      tags: [`tag${i % 10}`],
      projects: i % 5 === 0 ? ["synthetic"] : [],
      language: i % 2 === 0 ? "de" : "en",
    });
    writeRaw(root, `items/${citekey}/${citekey}.md`, itemFile(fm, sentence(i + 3, 60)));
    const card = cardData(citekey, sentence(i + 11, 25));
    writeRaw(root, `items/${citekey}/cards/${card.fm.id}.md`, cardFile(card));
  }
}
