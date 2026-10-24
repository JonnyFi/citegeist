import {
  Block,
  CardBody,
  CardFrontmatter,
  ItemFrontmatter,
  LibraryManifest,
  NoteFrontmatter,
  ProjectFrontmatter,
} from "@citegeist/schema";
import type { z } from "zod";
import { CardBodyError, parseCardBody } from "./card-body.js";
import type { Classified } from "./classify.js";
import { MarkdownFile } from "./frontmatter.js";
import { quoteSha256 } from "./hash.js";

export interface Issue {
  code: string;
  message: string;
}

export type Parsed =
  | { kind: "manifest"; manifest: LibraryManifest }
  | { kind: "item"; citekey: string; fm: ItemFrontmatter; body: string }
  | {
      kind: "card";
      citekey: string;
      fm: CardFrontmatter;
      body: CardBody;
      /** Text below the quote, for wiki link extraction. */
      quoteOk: boolean;
    }
  | { kind: "note"; slug: string; fm: NoteFrontmatter; body: string }
  | { kind: "project"; slug: string; fm: ProjectFrontmatter; body: string }
  | { kind: "blocks"; citekey: string; source: string; blocks: Block[] };

export type ParseResult =
  | { ok: true; parsed: Parsed; warnings: Issue[] }
  | { ok: false; issues: Issue[] };

export function formatZodError(err: z.ZodError): string {
  const shown = err.issues
    .slice(0, 5)
    .map((i) => `${i.path.length > 0 ? i.path.join(".") : "(root)"}: ${i.message}`);
  const more = err.issues.length > 5 ? ` (+${err.issues.length - 5} more)` : "";
  return shown.join("; ") + more;
}

const fail = (code: string, message: string): ParseResult => ({
  ok: false,
  issues: [{ code, message }],
});

function readFrontmatter(
  raw: string,
): { ok: true; file: MarkdownFile; data: Record<string, unknown> } | { ok: false; r: ParseResult } {
  const file = MarkdownFile.parse(raw);
  if (!file.hasFrontmatter) {
    return {
      ok: false,
      r: fail("FRONTMATTER_MISSING", "file has no YAML frontmatter between '---' lines"),
    };
  }
  if (file.yamlErrors.length > 0) {
    return { ok: false, r: fail("YAML_INVALID", file.yamlErrors.slice(0, 3).join("; ")) };
  }
  const data = file.data;
  if (!data) return { ok: false, r: fail("FRONTMATTER_INVALID", "frontmatter is not a mapping") };
  return { ok: true, file, data };
}

/** Parses and validates one library file. `rel` is only used for messages. */
export function parseLibraryFile(
  c: Exclude<Classified, { kind: "conflict" | "placeholder" }>,
  raw: string,
): ParseResult {
  switch (c.kind) {
    case "manifest": {
      let json: unknown;
      try {
        json = JSON.parse(raw);
      } catch (e) {
        return fail("JSON_INVALID", `citegeist.json is not valid JSON: ${(e as Error).message}`);
      }
      const r = LibraryManifest.safeParse(json);
      return r.success
        ? { ok: true, parsed: { kind: "manifest", manifest: r.data }, warnings: [] }
        : fail("SCHEMA_INVALID", formatZodError(r.error));
    }
    case "item": {
      const fmr = readFrontmatter(raw);
      if (!fmr.ok) return fmr.r;
      const r = ItemFrontmatter.safeParse(fmr.data);
      if (!r.success) return fail("SCHEMA_INVALID", formatZodError(r.error));
      if (r.data.citekey !== c.key) {
        return fail(
          "CITEKEY_MISMATCH",
          `frontmatter citekey '${r.data.citekey}' differs from folder name '${c.key}'`,
        );
      }
      return {
        ok: true,
        parsed: { kind: "item", citekey: c.key, fm: r.data, body: fmr.file.body },
        warnings: r.data.incomplete
          ? [
              {
                code: "ITEM_INCOMPLETE",
                message: `ingest did not finish (${r.data.incomplete.code}): ${r.data.incomplete.message}`,
              },
            ]
          : [],
      };
    }
    case "card": {
      const fmr = readFrontmatter(raw);
      if (!fmr.ok) return fmr.r;
      const r = CardFrontmatter.safeParse(fmr.data);
      if (!r.success) return fail("SCHEMA_INVALID", formatZodError(r.error));
      if (r.data.id !== c.key) {
        return fail("ID_MISMATCH", `card id '${r.data.id}' differs from file name '${c.key}'`);
      }
      if (r.data.item !== c.citekey) {
        return fail(
          "CITEKEY_MISMATCH",
          `card item '${r.data.item}' differs from folder name '${c.citekey}'`,
        );
      }
      let body: CardBody;
      try {
        body = CardBody.parse(parseCardBody(fmr.file.body));
      } catch (e) {
        if (e instanceof CardBodyError) return fail("CARD_BODY_INVALID", e.message);
        if (e && typeof e === "object" && "issues" in e) {
          return fail("CARD_BODY_INVALID", formatZodError(e as z.ZodError));
        }
        throw e;
      }
      const quoteOk = quoteSha256(body.quote) === r.data.quote_sha256;
      return {
        ok: true,
        parsed: { kind: "card", citekey: c.citekey ?? "", fm: r.data, body, quoteOk },
        warnings: quoteOk
          ? []
          : [
              {
                code: "QUOTE_HASH_MISMATCH",
                message:
                  "quote_sha256 does not match the quote text; the verbatim quote was changed after the card was created",
              },
            ],
      };
    }
    case "note": {
      const fmr = readFrontmatter(raw);
      if (!fmr.ok) return fmr.r;
      const r = NoteFrontmatter.safeParse(fmr.data);
      if (!r.success) return fail("SCHEMA_INVALID", formatZodError(r.error));
      return {
        ok: true,
        parsed: { kind: "note", slug: c.key, fm: r.data, body: fmr.file.body },
        warnings: [],
      };
    }
    case "project": {
      const fmr = readFrontmatter(raw);
      if (!fmr.ok) return fmr.r;
      const r = ProjectFrontmatter.safeParse(fmr.data);
      if (!r.success) return fail("SCHEMA_INVALID", formatZodError(r.error));
      if (r.data.slug !== c.key) {
        return fail(
          "SLUG_MISMATCH",
          `project slug '${r.data.slug}' differs from folder name '${c.key}'`,
        );
      }
      return {
        ok: true,
        parsed: { kind: "project", slug: c.key, fm: r.data, body: fmr.file.body },
        warnings: [],
      };
    }
    case "blocks": {
      const blocks: Block[] = [];
      const bad: number[] = [];
      const lines = raw.split("\n");
      for (const [i, line] of lines.entries()) {
        if (line.trim() === "") continue;
        try {
          const r = Block.safeParse(JSON.parse(line));
          if (r.success) blocks.push(r.data);
          else bad.push(i + 1);
        } catch {
          bad.push(i + 1);
        }
      }
      return {
        ok: true,
        parsed: { kind: "blocks", citekey: c.citekey ?? "", source: c.source ?? "", blocks },
        warnings:
          bad.length > 0
            ? [
                {
                  code: "BLOCKS_INVALID",
                  message: `${bad.length} invalid line(s) in blocks.jsonl skipped, first at line ${bad[0]}`,
                },
              ]
            : [],
      };
    }
  }
}
