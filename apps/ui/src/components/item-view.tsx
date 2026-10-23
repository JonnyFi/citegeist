import { cardsList, itemsGet } from "@citegeist/ops";
import { Link } from "@tanstack/react-router";
import { ExternalLink, FileText, Quote } from "lucide-react";
import { ConnectionsPanel } from "../connections";
import { useI18n } from "../i18n";
import { itemCardsInput } from "../lib/cards";
import { creatorName, statusLabel, typeLabel } from "../lib/format";
import { useOp } from "../lib/hooks";
import { CardList } from "./card-list";
import { actorLabel } from "./inbox-screen";
import { Prose } from "./prose";
import { ReaderTab } from "./reader-tab";
import { Badge } from "./ui/badge";
import { Segmented } from "./ui/segmented";
import { EmptyState, ErrorState, Loading } from "./ui/states";

export type ItemTab = "overview" | "read";

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-10">
      <h2 className="mb-3 flex items-baseline gap-2 border-b border-line pb-1.5 text-xs font-medium uppercase tracking-wide text-muted">
        {title}
        {count !== undefined ? <span className="tabular-nums">{count}</span> : null}
      </h2>
      {children}
    </section>
  );
}

/** One item: an overview (metadata, literature note, cards) and a reading tab with the reader. */
export function ItemView({
  citekey,
  tab = "overview",
  cardId,
  onChange,
}: {
  citekey: string;
  tab?: ItemTab;
  /** The card open in the reader. */
  cardId?: string | undefined;
  onChange?: (next: { tab: ItemTab; card?: string | undefined }) => void;
}) {
  const i18n = useI18n();
  const { t } = i18n;
  const item = useOp(itemsGet, { citekey });
  const cards = useOp(cardsList, itemCardsInput(citekey));

  if (item.isPending) return <Loading label={t("item.loading")} />;
  if (item.isError) return <ErrorState error={item.error} />;

  const { frontmatter: fm, note } = item.data;
  const authors = (fm.author ?? []).map(creatorName);
  const meta: Array<[string, string | undefined]> = [
    [t("meta.type"), typeLabel(i18n, fm.type)],
    [t("meta.publishedIn"), fm["container-title"]],
    [t("meta.publisher"), fm.publisher],
    [t("meta.volume"), fm.volume],
    [t("meta.issue"), fm.issue],
    [t("meta.pages"), fm.page],
    ["DOI", fm.DOI],
    ["ISBN", fm.ISBN],
    [t("meta.language"), fm.language],
    [t("meta.citekey"), fm.citekey],
  ];

  const tabs = (
    <div className="flex h-11 shrink-0 items-center gap-4 border-b border-line px-6">
      <Segmented
        label={t("item.tabs")}
        value={tab}
        onChange={(next) => onChange?.({ tab: next, card: cardId })}
        options={[
          { value: "overview", label: t("item.tabOverview") },
          { value: "read", label: t("item.tabRead") },
        ]}
      />
      <span className="min-w-0 truncate font-serif text-[15px] font-medium">{fm.title}</span>
    </div>
  );

  if (tab === "read") {
    return (
      <div className="flex h-full min-h-0 flex-col">
        {tabs}
        <div className="min-h-0 flex-1">
          {cards.isPending ? (
            <Loading label={t("item.loadingCards")} />
          ) : cards.isError ? (
            <ErrorState error={cards.error} />
          ) : (
            <ReaderTab
              fm={fm}
              cards={cards.data.cards}
              selectedId={cardId}
              onSelect={(id) => onChange?.({ tab: "read", card: id })}
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-col">
      {tabs}
      <article className="mx-auto w-full max-w-3xl px-8 py-10">
        <header>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Badge tone={fm.status === "reading" ? "accent" : "neutral"}>
              {statusLabel(i18n, fm.status)}
            </Badge>
            {fm.inbox ? <Badge tone="outline">{t("nav.inbox")}</Badge> : null}
            {fm.projects.map((slug) => (
              <Link key={slug} to="/projects/$slug" params={{ slug }}>
                <Badge tone="outline" className="hover:text-ink">
                  {slug}
                </Badge>
              </Link>
            ))}
          </div>
          <h1 className="font-serif text-3xl font-semibold leading-tight">{fm.title}</h1>
          {fm.subtitle ? <p className="mt-1 font-serif text-lg text-muted">{fm.subtitle}</p> : null}
          <p className="mt-3 text-base">
            {authors.length > 0 ? authors.join("; ") : t("item.unknownAuthor")}
            {fm.issued !== undefined ? (
              <span className="text-muted"> ({String(fm.issued)})</span>
            ) : null}
          </p>
          {fm.inbox?.why ? (
            <p className="mt-3 rounded-md bg-accent-soft px-3 py-2 text-accent">
              {t("item.suggestedBy", { who: actorLabel(i18n, fm.inbox.by), why: fm.inbox.why })}
            </p>
          ) : null}
        </header>

        {fm.abstract ? (
          <Section title={t("item.abstract")}>
            <p className="prose-read">{fm.abstract}</p>
          </Section>
        ) : null}

        <Section title={t("item.metadata")}>
          <dl className="grid grid-cols-[8rem_1fr] gap-x-4 gap-y-1.5">
            {meta
              .filter((row): row is [string, string] => Boolean(row[1]))
              .map(([label, value]) => (
                <div key={label} className="contents">
                  <dt className="text-muted">{label}</dt>
                  <dd className="min-w-0 break-words">{value}</dd>
                </div>
              ))}
            {fm.URL ? (
              <div className="contents">
                <dt className="text-muted">URL</dt>
                <dd className="min-w-0 break-all">
                  <a
                    href={fm.URL}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-accent"
                  >
                    {fm.URL}
                    <ExternalLink className="size-3" />
                  </a>
                </dd>
              </div>
            ) : null}
            {fm.tags.length > 0 ? (
              <div className="contents">
                <dt className="text-muted">{t("meta.tags")}</dt>
                <dd className="flex flex-wrap gap-1.5">
                  {fm.tags.map((tag) => (
                    <Badge key={tag}>{tag}</Badge>
                  ))}
                </dd>
              </div>
            ) : null}
          </dl>
          {fm.sources.length > 0 ? (
            <ul className="mt-3 flex flex-col gap-1">
              {fm.sources.map((s) => (
                <li key={s.hash} className="flex items-center gap-2 text-muted">
                  <FileText className="size-3.5" />
                  {s.filename}
                  {s.pages ? <span>({t("item.pageCount", { n: s.pages })})</span> : null}
                </li>
              ))}
            </ul>
          ) : null}
        </Section>

        <Section title={t("item.note")}>
          {note.trim() ? <Prose text={note} /> : <p className="text-muted">{t("item.noNote")}</p>}
        </Section>

        <Section title={t("item.cards")} count={cards.data?.cards.length ?? item.data.cards}>
          {cards.isPending ? (
            <Loading label={t("item.loadingCards")} />
          ) : cards.isError ? (
            <ErrorState error={cards.error} />
          ) : cards.data.cards.length === 0 ? (
            <EmptyState
              icon={<Quote className="size-5" />}
              title={t("item.noCardsTitle")}
              description={t("item.noCardsDescription")}
            />
          ) : (
            <CardList
              cards={cards.data.cards}
              onOpen={(id) => onChange?.({ tab: "read", card: id })}
            />
          )}
        </Section>

        <ConnectionsPanel kind="item" id={citekey} />
      </article>
    </div>
  );
}
