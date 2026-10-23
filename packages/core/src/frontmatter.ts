import { isDeepStrictEqual } from "node:util";
import { Document, isMap, isScalar, parseDocument } from "yaml";

const FENCE = /^---[ \t]*\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/;
const LEAD = /^(?:[ \t]*\r?\n)*/;
const TAIL = /(?:\r?\n[ \t]*)*$/;

const STRINGIFY = { lineWidth: 0, flowCollectionPadding: false } as const;

/**
 * A Markdown file with YAML frontmatter, kept in pieces so that an unchanged file serializes to
 * the identical bytes and a changed one keeps key order, comments and unknown keys.
 */
export class MarkdownFile {
  private constructor(
    /** Parsed YAML. Null when the file has no frontmatter block. */
    private doc: Document | null,
    /** Exact text of the frontmatter block including both fences, "" when absent. */
    private head: string,
    private dirty: boolean,
    /** Blank lines between the closing fence and the text. */
    private lead: string,
    /** Text without leading blank lines and trailing line breaks. */
    private text: string,
    /** Trailing line breaks of the file. */
    private tail: string,
    readonly yamlErrors: string[],
  ) {}

  static parse(raw: string): MarkdownFile {
    const m = FENCE.exec(raw);
    const head = m ? m[0] : "";
    const rest = raw.slice(head.length);
    const lead = LEAD.exec(rest)?.[0] ?? "";
    const afterLead = rest.slice(lead.length);
    const tail = TAIL.exec(afterLead)?.[0] ?? "";
    const text = afterLead.slice(0, afterLead.length - tail.length);
    let doc: Document | null = null;
    const yamlErrors: string[] = [];
    if (m) {
      doc = parseDocument(m[1] ?? "", { prettyErrors: false });
      for (const e of doc.errors) yamlErrors.push(e.message);
    }
    return new MarkdownFile(doc, head, false, lead, text, tail, yamlErrors);
  }

  /** Creates a new file from plain data (key order is the object's key order). */
  static create(data: Record<string, unknown>, body = ""): MarkdownFile {
    const doc = new Document(data);
    const file = new MarkdownFile(doc, "", true, "\n", "", "\n", []);
    file.setBody(body);
    return file;
  }

  get hasFrontmatter(): boolean {
    return this.doc !== null;
  }

  /** Frontmatter as plain JSON data. Null when absent or not a mapping. */
  get data(): Record<string, unknown> | null {
    if (!this.doc || this.yamlErrors.length > 0 || !isMap(this.doc.contents)) return null;
    return this.doc.toJS() as Record<string, unknown>;
  }

  /** The text after the frontmatter, without surrounding blank lines. */
  get body(): string {
    return this.text;
  }

  setBody(body: string): void {
    const wasEmpty = this.text === "";
    this.text = body.replace(/^(?:[ \t]*\r?\n)+/, "").replace(/(?:\r?\n[ \t]*)+$/, "");
    if (this.text === "") {
      this.lead = "";
      this.tail = "";
    } else {
      if (wasEmpty && this.lead === "" && this.doc) this.lead = "\n";
      if (this.tail === "") this.tail = "\n";
    }
  }

  /**
   * Applies a patch to the top-level keys. Equal values stay untouched (so comments survive),
   * `undefined` deletes a key, new keys are appended.
   */
  patch(patch: Record<string, unknown>): void {
    const doc = this.ensureDoc();
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) {
        if (doc.has(key)) {
          doc.delete(key);
          this.dirty = true;
        }
        continue;
      }
      if (doc.has(key)) {
        const node = doc.get(key, true);
        if (isDeepStrictEqual(toJs(doc, key), value)) continue;
        if (isScalar(node) && isPrimitive(value)) {
          node.value = value;
          this.dirty = true;
          continue;
        }
      }
      doc.set(key, doc.createNode(value));
      this.dirty = true;
    }
  }

  /** Replaces all top-level keys with `data`, keeping comments and style of unchanged keys. */
  replaceData(data: Record<string, unknown>): void {
    const doc = this.ensureDoc();
    const keep = new Set(Object.keys(data));
    const current = doc.toJS() as Record<string, unknown> | null;
    for (const key of Object.keys(current ?? {})) {
      if (!keep.has(key)) this.patch({ [key]: undefined });
    }
    this.patch(data);
  }

  toString(): string {
    let head = this.head;
    if (this.dirty && this.doc) {
      const isEmpty = isMap(this.doc.contents) && this.doc.contents.items.length === 0;
      head = isEmpty ? "---\n---\n" : `---\n${this.doc.toString(STRINGIFY)}---\n`;
    }
    return head + this.lead + this.text + this.tail;
  }

  private ensureDoc(): Document {
    if (!this.doc) {
      this.doc = new Document({});
      this.lead = this.lead === "" ? "\n" : this.lead;
      this.dirty = true;
    }
    return this.doc;
  }
}

function toJs(doc: Document, key: string): unknown {
  const node = doc.get(key, true);
  if (node && typeof node === "object" && "toJS" in node) {
    return (node as { toJS(d: Document): unknown }).toJS(doc);
  }
  return node;
}

function isPrimitive(v: unknown): v is string | number | boolean | null {
  return v === null || ["string", "number", "boolean"].includes(typeof v);
}
