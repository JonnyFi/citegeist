import { Menu } from "@base-ui/react/menu";
import { Popover } from "@base-ui/react/popover";
import type { Suggestion } from "@citegeist/editor";
import { type CardLink, linksCreate, linksDecide, linksForItem, linksRemove } from "@citegeist/ops";
import { Relation } from "@citegeist/schema";
import { Link2, MoreHorizontal, Sparkles } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { sendCardToChat } from "../chat";
import type { CardData } from "../components/card-list";
import { useOpenAgent } from "../components/layout";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Select } from "../components/ui/select";
import { type I18n, useI18n } from "../i18n";
import { useOp, useOpMutation } from "../lib/hooks";
import { cn, describeError } from "../lib/utils";
import { useLibraryLinks } from "../notes/library-links";

/** German label of a relation as the card words it: "widerspricht". */
function relLabel({ t, has }: Pick<I18n, "t" | "has">, rel: string | undefined): string {
  const key = `rel.${rel ?? "related"}`;
  return has(key) ? t(key) : (rel ?? "");
}

const RESULTS = 8;

/** Search over items, cards and notes with the editor's `[[` completion as its source. */
function TargetSearch({
  excludeId,
  onPick,
}: {
  excludeId: string;
  onPick: (target: Suggestion) => void;
}) {
  const { t } = useI18n();
  const { provider } = useLibraryLinks();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [results, setResults] = useState<Suggestion[]>([]);
  const listId = useId();

  useEffect(() => {
    if (!provider || query.trim() === "") {
      setResults([]);
      return;
    }
    let live = true;
    void Promise.resolve(provider.suggest(query, { embed: false })).then((found) => {
      if (!live) return;
      setResults(found.filter((s) => s.target !== excludeId).slice(0, RESULTS));
      setActive(0);
    });
    return () => {
      live = false;
    };
  }, [provider, query, excludeId]);

  const open = query.trim() !== "";
  return (
    <div className="flex flex-col gap-1">
      <Input
        autoFocus
        role="combobox"
        aria-label={t("cardLink.target")}
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={results[active] ? `${listId}-${active}` : undefined}
        placeholder={t("cardLink.targetPlaceholder")}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, results.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter" && results[active]) {
            e.preventDefault();
            onPick(results[active]);
          }
        }}
      />
      {open ? (
        <div
          id={listId}
          role="listbox"
          aria-label={t("cardLink.results")}
          className="max-h-48 overflow-y-auto border border-line-faint"
        >
          {results.length === 0 ? (
            <div className="px-2 py-1.5 text-[12px] text-muted">{t("cardLink.noResults")}</div>
          ) : (
            results.map((s, i) => (
              <div
                key={`${s.kind}:${s.target}`}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                tabIndex={-1}
                onMouseEnter={() => setActive(i)}
                onClick={() => onPick(s)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onPick(s);
                }}
                className={cn(
                  "flex cursor-default items-baseline gap-2 px-2 py-1.5 text-[12px]",
                  i === active && "bg-sunken",
                )}
              >
                <span className="shrink-0 text-[10px] uppercase tracking-[0.08em] text-muted">
                  {t(`cardLink.kind.${s.kind}`)}
                </span>
                <span className="min-w-0 flex-1 truncate">{s.label}</span>
                {s.detail ? <span className="shrink-0 truncate text-muted">{s.detail}</span> : null}
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

/** The form in the popover: target, relation, optional reason. */
function ConnectForm({ cardId, onDone }: { cardId: string; onDone: () => void }) {
  const { t } = useI18n();
  const create = useOpMutation(linksCreate);
  const [target, setTarget] = useState<Suggestion | null>(null);
  const [rel, setRel] = useState<string>("related");
  const [why, setWhy] = useState("");
  const whyId = useId();

  const save = () => {
    if (!target) return;
    const reason = why.trim();
    create.mutate(
      {
        from: cardId,
        link: {
          to: `[[${target.target}]]`,
          rel: Relation.parse(rel),
          ...(reason ? { why: reason } : {}),
        },
      },
      { onSuccess: onDone },
    );
  };

  return (
    <form
      className="flex flex-col gap-2.5 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <Popover.Title className="text-label font-semibold uppercase tracking-[0.1em] text-muted">
        {t("cardLink.title")}
      </Popover.Title>
      {target ? (
        <div className="flex items-center gap-2 border border-line px-2 py-1 text-[12px]">
          <Badge tone="neutral">{t(`cardLink.kind.${target.kind}`)}</Badge>
          <span className="min-w-0 flex-1 truncate">
            {target.label}
            {target.detail ? <span className="text-muted">{` · ${target.detail}`}</span> : null}
          </span>
          <button
            type="button"
            onClick={() => setTarget(null)}
            className="shrink-0 text-muted underline-offset-2 hover:text-ink hover:underline"
          >
            {t("cardLink.clearTarget")}
          </button>
        </div>
      ) : (
        <TargetSearch excludeId={cardId} onPick={setTarget} />
      )}
      <div className="flex flex-col gap-1">
        <span className="text-[11px] text-muted">{t("cardLink.relation")}</span>
        <Select
          label={t("cardLink.relation")}
          value={rel}
          onChange={setRel}
          options={Relation.options.map((r) => ({ value: r, label: t(`rel.${r}`) }))}
          className="w-full"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={whyId} className="text-[11px] text-muted">
          {t("cardLink.why")}
        </label>
        <Input
          id={whyId}
          value={why}
          placeholder={t("cardLink.whyPlaceholder")}
          onChange={(e) => setWhy(e.target.value)}
        />
      </div>
      {create.isError ? (
        <p role="alert" className="text-[12px] text-danger">
          {describeError(create.error, t("cardLink.failed")).message}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button size="sm" onClick={onDone}>
          {t("cardLink.cancel")}
        </Button>
        <Button size="sm" variant="primary" type="submit" disabled={!target || create.isPending}>
          {t("cardLink.save")}
        </Button>
      </div>
    </form>
  );
}

/**
 * The "more" cell of the card's action bar. It opens a short menu with "Verbinden" (the connect
 * popover) and "An den Agent" (the card becomes a context chip of the chat). Nothing else of the
 * card changes while the menu is closed.
 */
export function CardMenu({
  card,
  className,
  onCiteOnly,
}: {
  card: CardData;
  className?: string;
  /** Puts the citation alone (no quote, no paraphrase) into the open text or on the clipboard. */
  onCiteOnly?: () => void;
}) {
  const { t } = useI18n();
  const { frontmatter: fm, body } = card;
  const trigger = useRef<HTMLButtonElement>(null);
  const [connecting, setConnecting] = useState(false);
  const openAgent = useOpenAgent();

  const toAgent = () => {
    const page = fm.locator?.start;
    sendCardToChat({
      citekey: fm.item,
      text: body.quote.slice(0, 8000),
      ...(page ? { page } : {}),
      card: fm.id,
    });
    openAgent();
  };

  const entry =
    "flex h-8 cursor-default items-center px-2.5 text-[12px] data-[highlighted]:bg-ink data-[highlighted]:text-bg";
  return (
    <>
      <Menu.Root>
        <Menu.Trigger
          ref={trigger}
          aria-label={t("cardLink.more")}
          title={t("cardLink.more")}
          className={cn(
            "flex h-8 w-9 shrink-0 items-center justify-center text-muted hover:bg-sunken hover:text-ink data-[popup-open]:bg-sunken",
            className,
          )}
        >
          <MoreHorizontal aria-hidden="true" className="size-4" />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner align="end" sideOffset={4} className="z-50">
            <Menu.Popup
              aria-label={t("cardLink.more")}
              className="min-w-40 border border-line bg-surface text-ink"
            >
              {onCiteOnly ? (
                <Menu.Item className={entry} onClick={onCiteOnly}>
                  {t("cardLink.citeOnly")}
                </Menu.Item>
              ) : null}
              <Menu.Item className={entry} onClick={() => setConnecting(true)}>
                {t("cardLink.connect")}
              </Menu.Item>
              <Menu.Item className={entry} onClick={toAgent}>
                {t("cardLink.toAgent")}
              </Menu.Item>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
      <Popover.Root open={connecting} onOpenChange={setConnecting}>
        <Popover.Portal>
          <Popover.Positioner
            anchor={trigger}
            side="top"
            align="end"
            sideOffset={4}
            className="z-50"
          >
            <Popover.Popup
              aria-label={t("cardLink.title")}
              className="w-80 max-w-[calc(100vw-1rem)] border border-line bg-surface text-ink"
            >
              <ConnectForm cardId={fm.id} onDone={() => setConnecting(false)} />
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </>
  );
}

/** "Land 2012" with the title as a tooltip. */
function targetText(link: CardLink): string {
  return link.short || link.label;
}

function ConnectionLine({ links }: { links: CardLink[] }) {
  const i18n = useI18n();
  const { t, tn } = i18n;
  const [open, setOpen] = useState(false);
  const remove = useOpMutation(linksRemove);
  const only = links.length === 1 ? links[0] : undefined;
  const summary = only
    ? `${relLabel(i18n, only.rel)} · ${targetText(only)}`
    : tn("cardLink.many", links.length);
  return (
    <div data-testid="card-connections" className="border-t border-line-faint">
      <button
        type="button"
        aria-expanded={open}
        title={only?.label}
        onClick={() => setOpen((o) => !o)}
        className="flex h-7 w-full items-center gap-1.5 px-3 text-left text-[12px] text-muted hover:text-ink"
      >
        <Link2 aria-hidden="true" className="size-3 shrink-0" />
        <span className="min-w-0 truncate">{summary}</span>
      </button>
      {open ? (
        <ul className="flex flex-col gap-1 px-3 pb-2">
          {links.map((l) => (
            <li key={`${l.note}:${l.index}`} className="flex items-baseline gap-2 text-[12px]">
              <span className="min-w-0 flex-1">
                <span className="text-muted">{relLabel(i18n, l.rel)} · </span>
                <span title={l.label}>{targetText(l)}</span>
                {l.why ? <span className="block text-muted">{l.why}</span> : null}
              </span>
              <button
                type="button"
                disabled={remove.isPending}
                aria-label={t("cardLink.removeLabel", { target: targetText(l) })}
                onClick={() =>
                  remove.mutate({
                    from: l.card,
                    to: `[[${l.to}]]`,
                    ...(l.rel ? { rel: l.rel } : {}),
                  })
                }
                className="shrink-0 text-muted underline-offset-2 hover:text-ink hover:underline"
              >
                {t("cardLink.remove")}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {remove.isError ? (
        <p role="alert" className="px-3 pb-2 text-[12px] text-danger">
          {describeError(remove.error, t("cardLink.removeFailed")).message}
        </p>
      ) : null}
    </div>
  );
}

function SuggestionLine({ link }: { link: CardLink }) {
  const i18n = useI18n();
  const { t } = i18n;
  const [open, setOpen] = useState(false);
  const decide = useOpMutation(linksDecide);
  const text = t("cardLink.suggestion", {
    rel: relLabel(i18n, link.rel),
    target: targetText(link),
  });
  return (
    <div data-testid="card-suggestion" className="border-t border-line-faint">
      <button
        type="button"
        aria-expanded={open}
        title={link.label}
        onClick={() => setOpen((o) => !o)}
        className="flex h-7 w-full items-center gap-1.5 px-3 text-left text-[12px] italic text-muted hover:text-ink"
      >
        <Sparkles aria-hidden="true" className="size-3 shrink-0" />
        <span className="min-w-0 truncate">{text}</span>
      </button>
      {open ? (
        <div className="flex flex-col gap-2 px-3 pb-2">
          {link.why ? <p className="text-[12px] leading-[1.5]">{link.why}</p> : null}
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="primary"
              disabled={decide.isPending}
              onClick={() => decide.mutate({ note: link.note, accept: [link.index], reject: [] })}
            >
              {t("cardLink.accept")}
            </Button>
            <Button
              size="sm"
              disabled={decide.isPending}
              onClick={() => decide.mutate({ note: link.note, accept: [], reject: [link.index] })}
            >
              {t("cardLink.dismiss")}
            </Button>
          </div>
          {decide.isError ? (
            <p role="alert" className="text-[12px] text-danger">
              {describeError(decide.error, t("cardLink.decideFailed")).message}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * What a card says about its connections, and nothing when there is nothing to say: one compact
 * line for the connections it has (the relation and the target, or their number, expanding on
 * click) and one subtle line for an open suggestion (expanding to accept or dismiss). The links
 * of all cards of an item come from one request.
 */
export function CardConnections({ card }: { card: CardData }) {
  const { frontmatter: fm } = card;
  const all = useOp(linksForItem, { citekey: fm.item });
  const mine = (all.data?.links ?? []).filter((l) => l.card === fm.id);
  const accepted = mine.filter((l) => l.status === "accepted");
  const suggestion = mine.find((l) => l.status === "proposed");
  if (accepted.length === 0 && !suggestion) return null;
  return (
    <>
      {accepted.length > 0 ? <ConnectionLine links={accepted} /> : null}
      {suggestion ? <SuggestionLine link={suggestion} /> : null}
    </>
  );
}
