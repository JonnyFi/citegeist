import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * Writes a small library as plain files, the way an external editor or an agent would. Tests use
 * it for both the Vitest server tests and the Playwright smoke test, so no native module has to
 * load in the test runner for the e2e seed.
 */

const STAMP = { at: "2026-10-01T09:00:00.000Z", by: "human" };
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

function write(root: string, rel: string, content: string): void {
  const abs = join(root, ...rel.split("/"));
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

// YAML is a superset of JSON, so frontmatter can be written as JSON.
const markdown = (fm: unknown, body = "") => `---\n${JSON.stringify(fm, null, 2)}\n---\n${body}\n`;

export const SEED = {
  libraryId: "01J0SEED00000000000000LIB1",
  items: {
    luhmann: "luhmann1984soziale",
    lewis: "lewis2020retrieval",
    habermas: "habermas1981theorie",
    inbox: "zuboff2019age",
  },
  quote: "Soziale Systeme bestehen aus Kommunikationen und nur aus Kommunikationen.",
} as const;

export function seedLibrary(root: string): void {
  write(
    root,
    "citegeist.json",
    `${JSON.stringify({ format: 1, id: SEED.libraryId, name: "Seed library" }, null, 2)}\n`,
  );

  const item = (n: number, citekey: string, extra: Record<string, unknown>) => ({
    id: `01J0SEED000000000000000${String(n).padStart(2, "0")}`,
    citekey,
    created: STAMP,
    ...extra,
  });

  write(
    root,
    `items/${SEED.items.luhmann}/${SEED.items.luhmann}.md`,
    markdown(
      item(1, SEED.items.luhmann, {
        type: "book",
        title: "Soziale Systeme",
        subtitle: "Grundriss einer allgemeinen Theorie",
        author: [{ family: "Luhmann", given: "Niklas" }],
        issued: 1984,
        publisher: "Suhrkamp",
        status: "reading",
        projects: ["phd-proposal"],
        tags: ["systems-theory"],
      }),
      "# Soziale Systeme\n\nKommunikation ist das Element sozialer Systeme.",
    ),
  );
  write(
    root,
    `items/${SEED.items.lewis}/${SEED.items.lewis}.md`,
    markdown(
      item(2, SEED.items.lewis, {
        type: "paper-conference",
        title: "Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks",
        author: [{ family: "Lewis", given: "Patrick" }],
        issued: 2020,
        status: "unread",
      }),
    ),
  );
  write(
    root,
    `items/${SEED.items.habermas}/${SEED.items.habermas}.md`,
    markdown(
      item(3, SEED.items.habermas, {
        type: "book",
        title: "Theorie des kommunikativen Handelns",
        author: [{ family: "Habermas", given: "Juergen" }],
        issued: 1981,
        status: "read",
        projects: ["phd-proposal"],
      }),
    ),
  );
  write(
    root,
    `items/${SEED.items.inbox}/${SEED.items.inbox}.md`,
    markdown(
      item(4, SEED.items.inbox, {
        type: "book",
        title: "The Age of Surveillance Capitalism",
        author: [{ family: "Zuboff", given: "Shoshana" }],
        issued: 2019,
        inbox: { by: "agent:claude-code", why: "Matches your platform critique search." },
      }),
    ),
  );

  const cardId = "c_01J0SEED00000000000000CD01";
  write(
    root,
    `items/${SEED.items.luhmann}/cards/${cardId}.md`,
    markdown(
      {
        id: cardId,
        item: SEED.items.luhmann,
        kind: "thesis",
        locator: { label: "page", start: "31", confirmed: true },
        anchor: { text: { exact: SEED.quote } },
        quote_sha256: sha(SEED.quote),
        projects: ["phd-proposal"],
        created: STAMP,
      },
      `> ${SEED.quote}\n\n## Note\n\nCommunication, not people, is the element.`,
    ),
  );

  write(
    root,
    "projects/phd-proposal/project.md",
    markdown(
      {
        slug: "phd-proposal",
        title: "PhD proposal",
        questions: [{ id: "q1", text: "How does systems theory apply to platforms?" }],
        created: STAMP,
      },
      "# Brief\n\nPlatforms as social systems.",
    ),
  );
}
