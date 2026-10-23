import { Block, CardBody } from "@citegeist/schema";
import { describe, expect, it } from "vitest";
import { parseCardBody, serializeCardBody } from "./card-body.js";
import { classify } from "./classify.js";
import { MarkdownFile } from "./frontmatter.js";
import { quoteSha256, sha256Hex } from "./hash.js";
import { parseLibraryFile } from "./parse.js";
import { extractWikiLinks } from "./wikilinks.js";

const ITEM = `---
# Luhmann, Soziale Systeme
id: 01JB8Z3QK7ABCDEFGH
citekey: luhmann1984soziale
type: book
title: Soziale Systeme   # trailing comment
author:
  - family: Luhmann
    given: Niklas
issued: 1984
publisher: Suhrkamp
custom-field: kept   # unknown CSL variable
ids: {}
tags: [systemtheorie, soziologie]
projects: []
status: unread
sources: []
provenance: {}
created:
  at: 2026-10-23T10:00:00.000Z
  by: human
---

# Literaturnotiz

Autopoiesis ist [[luhmann1984soziale#^b7f3k2q]] zentral.
`;

const QUOTE = "Soziale Systeme bestehen aus Kommunikationen.\n\nNicht aus Menschen.";

const CARD = `---
id: c_01JB8Z3Q7K
item: luhmann1984soziale
kind: quote
anchor:
  text:
    exact: Soziale Systeme bestehen aus Kommunikationen.
    prefix: ""
    suffix: ""
quote_sha256: ${quoteSha256(QUOTE)}
tags: []
projects: []
created:
  at: 2026-10-23T10:00:00.000Z
  by: human
---

> Soziale Systeme bestehen aus Kommunikationen.
>
> Nicht aus Menschen.

## Paraphrase

Systems consist of communications.

## Core statement

Communication is the unit.

## In my words

Mein Gedanke, siehe [[luhmann1984soziale]].

## Comment

## Reading list

- eigener Abschnitt
`;

const NOTE = `---
id: n_01JB9Z3Q7K
type: permanent
title: Autopoiesis erklärt Stabilität
links:
  - to: "[[luhmann1984soziale]]"
    rel: supports
    why: Kap. 1
    by: agent:claude-code
    status: proposed
tags: []
projects: [phd-proposal]
created:
  at: 2026-10-23T10:00:00.000Z
  by: human
---
Direkt unter dem Frontmatter, ohne Leerzeile.

Text mit [[c_01JB8Z3Q7K]] und ![[c_01JB8Z3Q7K]].
`;

const PROJECT = `---
slug: phd-proposal
title: PhD Proposal
status: active
questions:
  - id: q1
    text: Wie stabil sind soziale Systeme?
style: apa
locale: de-DE
export:
  paraphrase: own-else-ai
  labelAi: false
created:
  at: 2026-10-23T10:00:00.000Z
  by: human
---

Der Projektbrief.
`;

const MANIFEST = `${JSON.stringify(
  {
    format: 1,
    id: "lib-01JB8Z3Q7K",
    name: "Test",
    defaults: { ai_language: "de", style: "apa", locale: "de-DE", citekey: "auth.lower + year" },
  },
  null,
  2,
)}\n`;

const BLOCK_LINES = [
  {
    id: "bk2f9a1x",
    type: "paragraph",
    flow: "body",
    text: "Soziale Systeme sind kommunikativ.",
    spans: [{ page: 0, label: "1", start: 0, end: 34 }],
    src: { engine: "docling" },
  },
  {
    id: "bm3k7q2z",
    type: "heading",
    sec: "1",
    flow: "body",
    text: "Einleitung",
    spans: [{ page: 0, label: "1", start: 0, end: 10 }],
    src: { engine: "docling" },
  },
].map((b) => JSON.stringify(b));

describe("lossless round trip", () => {
  it("keeps item, card, note and project files byte-identical when unchanged", () => {
    for (const [rel, raw] of [
      ["items/luhmann1984soziale/luhmann1984soziale.md", ITEM],
      ["items/luhmann1984soziale/cards/c_01JB8Z3Q7K.md", CARD],
      ["notes/autopoiesis.md", NOTE],
      ["projects/phd-proposal/project.md", PROJECT],
    ] as const) {
      const c = classify(rel);
      expect(c, rel).not.toBeNull();
      if (!c || c.kind === "conflict" || c.kind === "placeholder") throw new Error("unreachable");
      const parsed = parseLibraryFile(c, raw);
      expect(parsed.ok, `${rel}: ${JSON.stringify(parsed)}`).toBe(true);
      expect(MarkdownFile.parse(raw).toString()).toBe(raw);
    }
  });

  it("parses and re-serializes the manifest and blocks.jsonl losslessly", () => {
    const m = parseLibraryFile({ kind: "manifest", key: "manifest" }, MANIFEST);
    expect(m.ok).toBe(true);
    if (m.ok && m.parsed.kind === "manifest") {
      expect(`${JSON.stringify(m.parsed.manifest, null, 2)}\n`).toBe(MANIFEST);
    }
    const raw = `${BLOCK_LINES.join("\n")}\n`;
    const b = parseLibraryFile(
      { kind: "blocks", key: "x/y", citekey: "luhmann1984soziale", source: "3f9a1c2e7b4d" },
      raw,
    );
    expect(b.ok).toBe(true);
    if (b.ok && b.parsed.kind === "blocks") {
      const out = b.parsed.blocks.map((blk) => JSON.stringify(Block.parse(blk)));
      expect(`${out.join("\n")}\n`).toBe(raw);
    }
  });

  it("keeps comments, key order and unknown keys when a field changes", () => {
    const f = MarkdownFile.parse(ITEM);
    f.patch({ title: "Soziale Systeme (2. Aufl.)", status: "read" });
    const out = f.toString();
    expect(out).toContain("# Luhmann, Soziale Systeme");
    expect(out).toContain("custom-field: kept # unknown CSL variable");
    expect(out).toContain("title: Soziale Systeme (2. Aufl.) # trailing comment");
    expect(out).toContain("status: read");
    expect(out.indexOf("id:")).toBeLessThan(out.indexOf("citekey:"));
    expect(out.indexOf("citekey:")).toBeLessThan(out.indexOf("publisher:"));
    expect(out.endsWith("zentral.\n")).toBe(true);
    // the rest of the file is untouched
    expect(out.replace("(2. Aufl.)", "").replace("read", "unread")).toContain("ids: {}");
  });

  it("appends new keys, removes deleted keys and replaces the body", () => {
    const f = MarkdownFile.parse(NOTE);
    f.patch({ title: "Neu", modified: { at: "2026-10-24T00:00:00.000Z", by: "agent:x" } });
    f.patch({ tags: undefined });
    f.setBody("Neuer Text");
    const out = f.toString();
    expect(out).not.toContain("tags:");
    expect(out).toContain("modified:");
    expect(out.endsWith("---\nNeuer Text\n")).toBe(true);
    const again = MarkdownFile.parse(out);
    expect(again.data?.title).toBe("Neu");
    expect(again.body).toBe("Neuer Text");
  });

  it("creates new files that parse back to the same data", () => {
    const data = { id: "n_01JB9Z3Q7K", title: "A: B # C", list: ["x", "y"], n: 3 };
    const out = MarkdownFile.create(data, "Body\n\nmore").toString();
    expect(out.startsWith("---\n")).toBe(true);
    const parsed = MarkdownFile.parse(out);
    expect(parsed.data).toEqual(data);
    expect(parsed.body).toBe("Body\n\nmore");
    expect(parsed.toString()).toBe(out);
  });
});

describe("card body", () => {
  it("parses sections and keeps unknown ones", () => {
    const file = MarkdownFile.parse(CARD);
    const body = parseCardBody(file.body);
    expect(body.quote).toBe(QUOTE);
    expect(body.paraphrase).toBe("Systems consist of communications.");
    expect(body.core).toBe("Communication is the unit.");
    expect(body.ownWords).toBe("Mein Gedanke, siehe [[luhmann1984soziale]].");
    expect(body.comment).toBe("");
    expect(body.extra).toEqual([{ heading: "Reading list", text: "- eigener Abschnitt" }]);
    expect(CardBody.safeParse(body).success).toBe(true);
  });

  it("serializes the canonical form back to the same text", () => {
    const file = MarkdownFile.parse(CARD);
    expect(serializeCardBody(parseCardBody(file.body))).toBe(file.body);
  });

  it("ignores headings inside code fences and accepts quote lines without a space", () => {
    const body = parseCardBody(">eins\n>zwei\n\n## In my words\n\n```\n## Not a heading\n```\n");
    expect(body.quote).toBe("eins\nzwei");
    expect(body.ownWords).toBe("```\n## Not a heading\n```");
    expect(body.extra).toEqual([]);
  });

  it("rejects bodies without a quote", () => {
    expect(() => parseCardBody("## Paraphrase\n\ntext")).toThrow(/blockquote/);
  });

  it("computes quote_sha256 over the quote with normalized line breaks", () => {
    expect(quoteSha256("a\r\nb")).toBe(sha256Hex("a\nb"));
    const c = classify("items/luhmann1984soziale/cards/c_01JB8Z3Q7K.md");
    if (!c || c.kind === "conflict" || c.kind === "placeholder") throw new Error("unreachable");
    const ok = parseLibraryFile(c, CARD);
    expect(ok.ok && ok.warnings).toEqual([]);
    const altered = parseLibraryFile(
      c,
      CARD.replace("Nicht aus Menschen.", "Nicht nur aus Menschen."),
    );
    expect(altered.ok && altered.warnings.map((w) => w.code)).toEqual(["QUOTE_HASH_MISMATCH"]);
  });
});

describe("validation and classification", () => {
  it("reports schema errors with the field path", () => {
    const c = classify("notes/x.md");
    if (!c || c.kind === "conflict" || c.kind === "placeholder") throw new Error("unreachable");
    const r = parseLibraryFile(c, "---\nid: wrong\ntitle: T\ncreated: {at: now, by: human}\n---\n");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.issues[0]?.code).toBe("SCHEMA_INVALID");
      expect(r.issues[0]?.message).toContain("id");
    }
    const noFm = parseLibraryFile(c, "just text");
    expect(!noFm.ok && noFm.issues[0]?.code).toBe("FRONTMATTER_MISSING");
    const badYaml = parseLibraryFile(c, "---\nid: [unclosed\n---\n");
    expect(!badYaml.ok && badYaml.issues[0]?.code).toBe("YAML_INVALID");
  });

  it("recognizes conflict copies, placeholders and plain files", () => {
    expect(classify("notes/foo 2.md")).toEqual({ kind: "conflict", original: "notes/foo.md" });
    expect(classify("items/a1/a1 2.md")).toEqual({ kind: "conflict", original: "items/a1/a1.md" });
    expect(classify("items/a1/cards/c_X 3.md")?.kind).toBe("conflict");
    expect(classify("notes/.foo.md.icloud")?.kind).toBe("placeholder");
    expect(classify("notes/foo.md")?.kind).toBe("note");
    expect(classify("items/a1/other.md")).toBeNull();
    expect(classify("chats/2026-10-23-x.md")).toBeNull();
    expect(classify("items/a1/derived/3f9a1c2e7b4d/blocks.jsonl")?.kind).toBe("blocks");
  });

  it("extracts wiki links but not those in code", () => {
    const refs = extractWikiLinks("a [[x]] `[[no]]` ![[c_1]] [[y#^b1|alias]]\n```\n[[no2]]\n```");
    expect(refs.map((r) => r.target)).toEqual(["x", "c_1", "y"]);
    expect(refs[1]?.embed).toBe(true);
    expect(refs[2]?.anchor).toBe("^b1");
  });
});
