import { scanWikiLinks } from "@citegeist/editor";
import {
  type Backlink,
  type NoteSummary,
  notesBacklinks,
  notesCreate,
  notesGet,
  notesList,
  notesUpdate,
  type Registry,
} from "@citegeist/ops";
import type { NoteFrontmatter } from "@citegeist/schema";
import type { CoreEvent } from "../lib/core";
import type { MockData } from "../mock/fixtures";

interface MockNote {
  slug: string;
  frontmatter: NoteFrontmatter;
  body: string;
}

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
function noteId(): string {
  let out = "";
  for (let i = 0; i < 16; i++) out += CROCKFORD[Math.floor(Math.random() * CROCKFORD.length)];
  return `n_${out}`;
}

function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "notiz";
}

/** What the core does to a note body on save: no leading blank lines, no trailing whitespace. */
function normalizeBody(body: string): string {
  return body.replace(/^(?:[ \t]*\r?\n)+/, "").replace(/(?:\r?\n[ \t]*)+$/, "");
}

const STORES = new WeakMap<MockData, Map<string, MockNote>>();

function seed(data: MockData): Map<string, MockNote> {
  const notes = new Map<string, MockNote>();
  const card = data.cards[0]?.frontmatter.id ?? "c_0000000000";
  const stamp = { at: "2026-10-05T09:00:00.000Z", by: "human" } as const;
  const add = (
    id: string,
    slug: string,
    title: string,
    body: string,
    at: string,
    type: NoteFrontmatter["type"] = "permanent",
  ) =>
    notes.set(id, {
      slug,
      body: normalizeBody(body),
      frontmatter: {
        id,
        type,
        title,
        links: [],
        tags: [],
        projects: [],
        created: { ...stamp, at },
        modified: { ...stamp, at },
      },
    });
  add(
    "n_0000000000000001",
    "autopoiesis-und-kommunikation",
    "Autopoiesis und Kommunikation",
    `# Autopoiesis und Kommunikation\n\nLuhmann übernimmt den Begriff aus der Biologie, siehe [[luhmann1984soziale]]. Die Kernstelle:\n\n![[${card}]]\n\nWeiter in [[zettelkasten-prinzip]].\n`,
    "2026-10-05T09:00:00.000Z",
  );
  add(
    "n_0000000000000002",
    "zettelkasten-prinzip",
    "Das Zettelkasten-Prinzip",
    "Eine Notiz, ein Gedanke. Verknüpfungen entstehen über **Wiki-Links**, nicht über Ordner.\n\n- [ ] Verbindung zu [[autopoiesis-und-kommunikation]] prüfen\n- [x] Begriff klären\n",
    "2026-10-04T09:00:00.000Z",
  );
  add(
    "n_0000000000000003",
    "frage-plattformen",
    "Wie wirken Plattformen auf Kommunikation?",
    "",
    "2026-10-03T09:00:00.000Z",
    "question",
  );
  return notes;
}

function storeFor(data: MockData): Map<string, MockNote> {
  let store = STORES.get(data);
  if (!store) {
    store = seed(data);
    STORES.set(data, store);
  }
  return store;
}

const toNote = (n: MockNote) => ({
  frontmatter: n.frontmatter,
  body: n.body,
  path: `/mock/library/notes/${n.slug}.md`,
});

const toSummary = (n: MockNote): NoteSummary => ({
  id: n.frontmatter.id,
  slug: n.slug,
  title: n.frontmatter.title,
  type: n.frontmatter.type,
  created: n.frontmatter.created.at,
  ...(n.frontmatter.modified ? { modified: n.frontmatter.modified.at } : {}),
  tags: n.frontmatter.tags,
  projects: n.frontmatter.projects,
});

/**
 * Notes for the mock core: the standard notes operations plus notes.list and notes.backlinks,
 * kept per fixture data set so every test starts from the same three notes.
 */
export function bindNotesMock(
  registry: Registry,
  data: MockData,
  emit: (event: CoreEvent) => void,
): Registry {
  const store = storeFor(data);
  const find = (id: string) => {
    const note = store.get(id);
    if (!note) throw new Error(`NOTE_NOT_FOUND: no note with id '${id}'`);
    return note;
  };
  const changed = (n: MockNote) =>
    emit({ type: "change", path: `notes/${n.slug}.md`, external: false });

  return registry
    .bind(notesList, async (_ctx, input) => {
      const q = input.query?.toLowerCase();
      const notes = [...store.values()]
        .filter((n) => (q ? `${n.frontmatter.title} ${n.slug}`.toLowerCase().includes(q) : true))
        .filter((n) => (input.project ? n.frontmatter.projects.includes(input.project) : true))
        .sort((a, b) =>
          (b.frontmatter.modified?.at ?? b.frontmatter.created.at).localeCompare(
            a.frontmatter.modified?.at ?? a.frontmatter.created.at,
          ),
        );
      return { notes: notes.slice(0, input.limit).map(toSummary) };
    })
    .bind(notesGet, async (_ctx, input) => toNote(find(input.id)))
    .bind(notesCreate, async (_ctx, input) => {
      const id = noteId();
      let slug = slugify(input.title);
      const taken = new Set([...store.values()].map((n) => n.slug));
      for (let n = 2; taken.has(slug); n++) slug = `${slugify(input.title)}-${n}`;
      const at = new Date().toISOString();
      const note: MockNote = {
        slug,
        body: normalizeBody(input.body),
        frontmatter: {
          id,
          type: input.type,
          title: input.title,
          links: [],
          tags: [],
          projects: input.projects,
          created: { at, by: "human" },
        },
      };
      store.set(id, note);
      changed(note);
      return toNote(note);
    })
    .bind(notesUpdate, async (_ctx, input) => {
      const note = find(input.id);
      if (input.title !== undefined) note.frontmatter = { ...note.frontmatter, title: input.title };
      if (input.body !== undefined) note.body = normalizeBody(input.body);
      note.frontmatter = {
        ...note.frontmatter,
        modified: { at: new Date().toISOString(), by: "human" },
      };
      changed(note);
      return toNote(note);
    })
    .bind(notesBacklinks, async (_ctx, input) => {
      const target = find(input.id);
      const hits = (text: string) =>
        scanWikiLinks(text).some(
          (m) => m.target === target.slug || m.target === target.frontmatter.id,
        );
      const backlinks: Backlink[] = [];
      for (const n of store.values()) {
        if (n === target || !hits(n.body)) continue;
        backlinks.push({
          kind: "note",
          id: n.frontmatter.id,
          title: n.frontmatter.title,
          status: "accepted",
          origin: "wiki",
        });
      }
      for (const [citekey, item] of data.items) {
        if (!hits(item.note)) continue;
        backlinks.push({
          kind: "item",
          id: citekey,
          citekey,
          title: item.frontmatter.title,
          status: "accepted",
          origin: "wiki",
        });
      }
      for (const card of data.cards) {
        const text = [card.body.ownWords, card.body.comment].filter(Boolean).join("\n");
        if (!hits(text)) continue;
        backlinks.push({
          kind: "card",
          id: card.frontmatter.id,
          citekey: card.frontmatter.item,
          title: card.body.quote.slice(0, 80),
          status: "accepted",
          origin: "wiki",
        });
      }
      return { backlinks };
    });
}
