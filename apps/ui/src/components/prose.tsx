import { Fragment, type ReactNode } from "react";

/** Wiki links stay visible as accent text; a later pass resolves them to routes. */
function inline(text: string): ReactNode[] {
  return text.split(/(\[\[[^\]]+\]\])/g).map((part, i) =>
    part.startsWith("[[") ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: static split, order never changes
      <span key={i} className="text-accent">
        {part.slice(2, -2).split("|").pop()}
      </span>
    ) : (
      // biome-ignore lint/suspicious/noArrayIndexKey: static split, order never changes
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}

/**
 * Minimal Markdown for notes and briefs: headings, bullet lists, paragraphs. The editor view that
 * replaces this renders real Markdown; this one only has to read well.
 */
export function Prose({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  let para: string[] = [];

  const flushList = () => {
    if (list.length === 0) return;
    const items = list;
    blocks.push(
      <ul key={`ul${blocks.length}`}>
        {items.map((li, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static list
          <li key={i}>{inline(li)}</li>
        ))}
      </ul>,
    );
    list = [];
  };
  const flushPara = () => {
    if (para.length === 0) return;
    blocks.push(<p key={`p${blocks.length}`}>{inline(para.join(" "))}</p>);
    para = [];
  };

  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    if (heading?.[1] && heading[2] !== undefined) {
      flushList();
      flushPara();
      // The page title is the item or project title, so a leading "# " becomes a section heading.
      const Tag = heading[1].length <= 2 ? "h2" : "h3";
      blocks.push(<Tag key={`h${blocks.length}`}>{inline(heading[2])}</Tag>);
    } else if (bullet?.[1] !== undefined) {
      flushPara();
      list.push(bullet[1]);
    } else if (line.trim() === "") {
      flushList();
      flushPara();
    } else {
      flushList();
      para.push(line.trim());
    }
  }
  flushList();
  flushPara();

  return <div className="prose-read">{blocks}</div>;
}
