import { cardsList, itemsList } from "@citegeist/ops";
import { Link } from "@tanstack/react-router";
import { Fragment, type ReactNode } from "react";
import { useI18n } from "../i18n";
import { withCardLocator } from "../lib/format";
import { useOp } from "../lib/hooks";

const CITE = /\[\[([^\]|#]+)(?:#(\^?[^\]|]+))?(?:\|([^\]]+))?\]\]/g;

export type TextPart =
  | { type: "text"; text: string }
  | { type: "cite"; target: string; anchor?: string; label?: string };

/** Splits agent text at its wiki-link citations. Unfinished `[[` stay text while the answer streams. */
export function splitCitations(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let last = 0;
  for (const m of text.matchAll(CITE)) {
    const at = m.index ?? 0;
    if (at > last) parts.push({ type: "text", text: text.slice(last, at) });
    const [, target = "", anchor, label] = m;
    parts.push({
      type: "cite",
      target: target.trim(),
      ...(anchor ? { anchor } : {}),
      ...(label ? { label: label.trim() } : {}),
    });
    last = at + m[0].length;
  }
  if (last < text.length) parts.push({ type: "text", text: text.slice(last) });
  return parts;
}

/** What the library knows, to tell a real citation from an invented one. */
interface Known {
  items: ReadonlySet<string>;
  cards: ReadonlyMap<
    string,
    {
      item: string;
      kind: string | undefined;
      locator: { label: string; start: string; end?: string | undefined } | undefined;
    }
  >;
}

/** Card kinds keep their colors from the design system; the word stays in the label. */
const KIND_COLOR: Record<string, string> = {
  thesis: "bg-card-thesis",
  finding: "bg-card-finding",
  definition: "bg-card-definition",
  method: "bg-card-method",
  example: "bg-card-example",
  critique: "bg-card-critique",
};

const CHIP =
  "inline-flex items-center gap-1 border border-line px-1.5 align-baseline font-mono text-[11px] leading-[1.4] whitespace-nowrap no-underline";

function Citation({
  part,
  known,
}: {
  part: Extract<TextPart, { type: "cite" }>;
  known: Known | null;
}) {
  const tr = useI18n();
  const { t } = tr;
  const { target, anchor, label } = part;
  const shown = label ?? (target.startsWith("c_") ? t("chat.citation.card") : target);
  // Until the library answers, a citation shows as a plain label instead of flashing as unknown.
  if (!known) return <>{shown}</>;

  if (target.startsWith("c_")) {
    const card = known.cards.get(target);
    if (!card) return <Unknown label={shown} />;
    const citekey = card.item;
    // the agent labels a card as it knows it; the locator term comes from the card itself
    const cardLabel = label ? withCardLocator(tr, label, card.locator) : shown;
    return (
      <Link
        to="/items/$citekey"
        params={{ citekey }}
        search={{ tab: "read", card: target }}
        aria-label={t("chat.citation.open", { label: cardLabel })}
        className={`${CHIP} hover:bg-sunken`}
      >
        <span
          aria-hidden="true"
          className={`size-1.5 ${(card.kind && KIND_COLOR[card.kind]) || "bg-card-none"}`}
        />
        {cardLabel}
      </Link>
    );
  }
  if (target.startsWith("n_")) {
    return (
      <Link
        to="/notes/$id"
        params={{ id: target }}
        aria-label={t("chat.citation.open", { label: shown })}
        className={`${CHIP} hover:bg-sunken`}
      >
        {shown}
      </Link>
    );
  }
  if (!known.items.has(target)) return <Unknown label={shown} />;
  return (
    <Link
      to="/items/$citekey"
      params={{ citekey: target }}
      search={anchor ? { tab: "read" } : {}}
      aria-label={t("chat.citation.open", { label: shown })}
      className={`${CHIP} hover:bg-sunken`}
    >
      {shown}
    </Link>
  );
}

/** A citation that matches nothing stored is marked, like an unsupported quote. */
function Unknown({ label }: { label: string }) {
  const { t } = useI18n();
  return (
    <span
      title={t("chat.citation.unknown", { label })}
      className={`${CHIP} border-dashed border-danger text-danger`}
    >
      {label}
      <span className="sr-only"> ({t("chat.citation.unknown", { label })})</span>
    </span>
  );
}

function inline(parts: TextPart[], known: Known | null): ReactNode[] {
  return parts.map((p, i) =>
    p.type === "text" ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: parts are rebuilt from the text on every render
      <Fragment key={i}>{p.text}</Fragment>
    ) : (
      // biome-ignore lint/suspicious/noArrayIndexKey: parts are rebuilt from the text on every render
      <Citation key={i} part={p} known={known} />
    ),
  );
}

/**
 * Agent answer as paragraphs and bullet lists, with citations as links to cards, pages and
 * sources. This is not a Markdown renderer: it covers what answers in a narrow column need.
 */
export function AssistantText({ text }: { text: string }) {
  const hasCites = text.includes("[[");
  const items = useOp(itemsList, { limit: 500 }, { enabled: hasCites });
  const cards = useOp(cardsList, { limit: 500 }, { enabled: hasCites });
  const known: Known = {
    items: new Set((items.data?.items ?? []).map((i) => i.citekey)),
    cards: new Map(
      (cards.data?.cards ?? []).map((c) => [
        c.frontmatter.id,
        {
          item: c.frontmatter.item,
          kind: c.frontmatter.kind,
          locator: c.frontmatter.locator,
        },
      ]),
    ),
  };
  const ready = !hasCites || (items.isSuccess && cards.isSuccess);

  const blocks: ReactNode[] = [];
  let list: string[] = [];
  let para: string[] = [];
  const render = (text: string) => inline(splitCitations(text), ready ? known : null);
  const flushList = () => {
    if (list.length === 0) return;
    const rows = list;
    blocks.push(
      <ul key={`ul${blocks.length}`} className="list-disc pl-5">
        {rows.map((li, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static list
          <li key={i}>{render(li)}</li>
        ))}
      </ul>,
    );
    list = [];
  };
  const flushPara = () => {
    if (para.length === 0) return;
    blocks.push(<p key={`p${blocks.length}`}>{render(para.join(" "))}</p>);
    para = [];
  };
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    if (bullet?.[1] !== undefined) {
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
  return <div className="flex flex-col gap-2 break-words">{blocks}</div>;
}
