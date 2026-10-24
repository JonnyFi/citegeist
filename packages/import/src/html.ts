// Converts the HTML of Zotero notes (ProseMirror note editor output) into Markdown. It handles the
// elements the note editor produces and degrades to plain text for everything else.

interface Element {
  tag: string;
  attrs: Record<string, string>;
  children: Node[];
}
type Node = Element | string;

const VOID = new Set(["br", "hr", "img", "meta", "link", "input", "wbr"]);
const DROP = new Set(["script", "style", "head", "title"]);

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  laquo: "«",
  raquo: "»",
  copy: "©",
  reg: "®",
  deg: "°",
  times: "×",
  auml: "ä",
  ouml: "ö",
  uuml: "ü",
  Auml: "Ä",
  Ouml: "Ö",
  Uuml: "Ü",
  szlig: "ß",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, body: string) => {
    if (body.startsWith("#")) {
      const code =
        body[1]?.toLowerCase() === "x" ? parseInt(body.slice(2), 16) : Number(body.slice(1));
      if (Number.isInteger(code) && code > 0 && code <= 0x10ffff) return String.fromCodePoint(code);
      return m;
    }
    return ENTITIES[body] ?? ENTITIES[body.toLowerCase()] ?? m;
  });
}

function parseAttrs(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([a-zA-Z_:][\w:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  for (const m of raw.matchAll(re)) {
    out[(m[1] ?? "").toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
  }
  return out;
}

export function parseHtml(html: string): Node[] {
  const root: Element = { tag: "#root", attrs: {}, children: [] };
  const stack: Element[] = [root];
  const top = (): Element => stack[stack.length - 1] ?? root;
  const re = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/g;
  let last = 0;
  for (const m of html.matchAll(re)) {
    const index = m.index ?? 0;
    if (index > last) top().children.push(html.slice(last, index));
    last = index + m[0].length;
    if (m[0].startsWith("<!--")) continue;
    const closing = m[1] === "/";
    const tag = (m[2] ?? "").toLowerCase();
    if (closing) {
      const at = stack.map((e) => e.tag).lastIndexOf(tag);
      if (at > 0) stack.length = at;
      continue;
    }
    const el: Element = { tag, attrs: parseAttrs(m[3] ?? ""), children: [] };
    top().children.push(el);
    const selfClosing = (m[3] ?? "").trimEnd().endsWith("/");
    if (!VOID.has(tag) && !selfClosing) stack.push(el);
  }
  if (last < html.length) top().children.push(html.slice(last));
  return root.children;
}

interface Ctx {
  pre: boolean;
}

function escapeText(s: string): string {
  return s.replace(/([\\`*_])/g, "\\$1");
}

function inline(nodes: Node[], ctx: Ctx): string {
  return nodes.map((n) => render(n, ctx)).join("");
}

function wrap(mark: string, inner: string): string {
  const trimmed = inner.trim();
  if (trimmed === "") return inner;
  const lead = inner.startsWith(" ") ? " " : "";
  const trail = inner.endsWith(" ") ? " " : "";
  return `${lead}${mark}${trimmed}${mark}${trail}`;
}

function block(content: string): string {
  const c = content.trim();
  return c === "" ? "" : `\n\n${c}\n\n`;
}

function textOf(nodes: Node[]): string {
  return nodes
    .map((n) => (typeof n === "string" ? decodeEntities(n) : textOf(n.children)))
    .join("");
}

function list(el: Element, ordered: boolean, ctx: Ctx): string {
  const items = el.children.filter((c): c is Element => typeof c !== "string" && c.tag === "li");
  const start = Number(el.attrs.start ?? 1) || 1;
  const lines = items.map((li, i) => {
    const marker = ordered ? `${start + i}. ` : "- ";
    const pad = " ".repeat(marker.length);
    const body = render(li, ctx).trim().split("\n");
    return body
      .map((line, n) => (n === 0 ? `${marker}${line}` : line === "" ? "" : `${pad}${line}`))
      .join("\n");
  });
  return block(lines.join("\n"));
}

function table(el: Element, ctx: Ctx): string {
  const rows: string[][] = [];
  const walk = (nodes: Node[]): void => {
    for (const n of nodes) {
      if (typeof n === "string") continue;
      if (n.tag === "tr") {
        rows.push(
          n.children
            .filter(
              (c): c is Element => typeof c !== "string" && (c.tag === "td" || c.tag === "th"),
            )
            .map((c) => inline(c.children, ctx).replace(/\s+/g, " ").replace(/\|/g, "\\|").trim()),
        );
      } else walk(n.children);
    }
  };
  walk(el.children);
  if (rows.length === 0) return "";
  const width = Math.max(...rows.map((r) => r.length));
  const pad = (r: string[]): string[] => [...r, ...Array(width - r.length).fill("")];
  const fmt = (r: string[]): string => `| ${pad(r).join(" | ")} |`;
  const [head = [], ...rest] = rows;
  const lines = [fmt(head), `| ${Array(width).fill("---").join(" | ")} |`, ...rest.map(fmt)];
  return block(lines.join("\n"));
}

function render(node: Node, ctx: Ctx): string {
  if (typeof node === "string") {
    const text = decodeEntities(node);
    if (ctx.pre) return text;
    return escapeText(text.replace(/\s+/g, " "));
  }
  const { tag } = node;
  if (DROP.has(tag)) return "";
  const kids = (): string => inline(node.children, ctx);
  switch (tag) {
    case "br":
      return "  \n";
    case "hr":
      return block("---");
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6":
      return block(`${"#".repeat(Number(tag.slice(1)))} ${kids().replace(/\s+/g, " ").trim()}`);
    case "p":
    case "div":
    case "section":
    case "article":
    case "body":
    case "html":
      return block(kids());
    case "strong":
    case "b":
      return wrap("**", kids());
    case "em":
    case "i":
      return wrap("*", kids());
    case "s":
    case "strike":
    case "del":
      return wrap("~~", kids());
    case "code": {
      const text = textOf(node.children);
      return text === "" ? "" : `\`${text.replace(/`/g, "'")}\``;
    }
    case "pre": {
      const text = textOf(node.children).replace(/^\n+|\s+$/g, "");
      return block(`\`\`\`\n${text}\n\`\`\``);
    }
    case "blockquote": {
      const inner = block(kids()).trim();
      return block(
        inner
          .split("\n")
          .map((l) => (l === "" ? ">" : `> ${l}`))
          .join("\n"),
      );
    }
    case "a": {
      const href = node.attrs.href;
      const text = kids();
      if (!href || !/^(https?:|mailto:)/i.test(href) || text.trim() === "") return text;
      return `[${text.trim()}](${href.replace(/\)/g, "%29")})`;
    }
    case "ul":
      return list(node, false, ctx);
    case "ol":
      return list(node, true, ctx);
    case "li":
      return kids();
    case "sup":
    case "sub": {
      const text = kids().trim();
      return text === "" ? "" : `<${tag}>${text}</${tag}>`;
    }
    case "img": {
      const src = node.attrs.src ?? "";
      return /^https?:/i.test(src) ? `![${node.attrs.alt ?? ""}](${src})` : "";
    }
    case "table":
      return table(node, ctx);
    default:
      return kids();
  }
}

/** Converts note HTML to Markdown. Unknown elements keep their text. */
export function htmlToMarkdown(html: string): string {
  const out = parseHtml(html)
    .map((n) => render(n, { pre: false }))
    .join("");
  return out
    .replace(/[ \t]+\n/g, (m) => (m.startsWith("  ") && m.length >= 3 ? "  \n" : "\n"))
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The first line of a note as plain text, for use as a title. */
export function noteTitle(markdown: string, max = 80): string | undefined {
  for (const raw of markdown.split("\n")) {
    const line = raw
      .replace(/^[#>\-*+\s]+|^\d+\.\s+/g, "")
      .replace(/[*_`~\\]/g, "")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\s+/g, " ")
      .trim();
    if (line !== "") return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
  }
  return undefined;
}
