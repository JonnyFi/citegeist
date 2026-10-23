export interface WikiLinkRef {
  /** Link target without anchor and alias, e.g. "luhmann1984soziale" or "c_01JB8Z3Q". */
  target: string;
  /** Part after "#", e.g. "^b7f3k2q". */
  anchor?: string;
  /** True for embeds written as ![[...]]. */
  embed: boolean;
}

const WIKI = /(!?)\[\[([^\]|#]+)(?:#([^\]|]*))?(?:\|[^\]]*)?\]\]/g;

/** Extracts [[wiki links]] from Markdown text. Links inside code spans and fences are ignored. */
export function extractWikiLinks(markdown: string): WikiLinkRef[] {
  const stripped = markdown.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`/g, "");
  const out: WikiLinkRef[] = [];
  for (const m of stripped.matchAll(WIKI)) {
    const ref: WikiLinkRef = { target: (m[2] ?? "").trim(), embed: m[1] === "!" };
    if (m[3] !== undefined && m[3] !== "") ref.anchor = m[3];
    if (ref.target !== "") out.push(ref);
  }
  return out;
}

/** Target of a frontmatter wiki link value like "[[luhmann1984soziale#^b7|alias]]". */
export function wikiTarget(value: string): string {
  return extractWikiLinks(value)[0]?.target ?? value.trim();
}
