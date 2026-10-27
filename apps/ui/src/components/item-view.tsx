import { cardsList, itemsGet, itemsResolve, projectsList } from "@citegeist/ops";
import type { ItemFrontmatter } from "@citegeist/schema";
import { Link, useNavigate } from "@tanstack/react-router";
import { ExternalLink, Quote } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { ConnectionsPanel } from "../connections";
import { useI18n } from "../i18n";
import { itemCardsInput } from "../lib/cards";
import { creatorName, statusLabel, typeLabel } from "../lib/format";
import { useOp, useOpMutation } from "../lib/hooks";
import { hasThinMetadata } from "../lib/metadata-form";
import { useReadingPosition } from "../lib/reading-position";
import { webUrl } from "../lib/safe-url";
import { useTrashItem } from "../lib/trash";
import { cn, describeError } from "../lib/utils";
import { markerOf, RelatedWorks, RetractionBadge, RetractionNote } from "../related";
import { AttachPdf } from "./attach-pdf";
import { CardList } from "./card-list";
import { CardColumnBar } from "./card-panel";
import { InboxBanner, MergeOfferNote, mergeOfferOf } from "./inbox-item";
import { HeaderSlot, Label, RightColumn, SubBar } from "./layout";
import {
  IdentifierForm,
  MetadataEditor,
  MetadataHint,
  type Notice,
  RenameOffer,
} from "./metadata-tools";
import { ProjectChips } from "./project-membership";
import { Prose } from "./prose";
import { ReaderTab } from "./reader-tab";
import { Badge, Stamp, StatusSquare } from "./ui/badge";
import { Button } from "./ui/button";
import { Segmented } from "./ui/segmented";
import { EmptyState, ErrorState, Loading } from "./ui/states";

/** The marker ingest leaves when no open source delivered a PDF: which sources it tried. */
function readNoFulltext(fm: ItemFrontmatter): { tried: string[] } | undefined {
  const marker = fm.fulltext;
  if (marker?.status !== "missing") return undefined;
  const names: Record<string, string> = {
    unpaywall: "Unpaywall",
    openalex: "OpenAlex",
    arxiv: "arXiv",
    publisher: "Verlagsseite",
  };
  // One entry per address tried: a source that named several shows once.
  return { tried: [...new Set(marker.tried.map((a) => names[a.source] ?? a.source))] };
}

export type ItemTab = "overview" | "read";

/**
 * Actions of the overview's sub bar: look the metadata up again (unless the hint on a thin item
 * carries that action), and pick the reading up where it stopped. The position comes from
 * localStorage until the core keeps it.
 */
function OverviewActions({
  citekey,
  onResume,
  onFetch,
  fetching,
  showFetch,
  showResume,
}: {
  citekey: string;
  onResume: () => void;
  onFetch: () => void;
  fetching: boolean;
  showFetch: boolean;
  /** An item in the inbox is read through the reading tab; "Lesen beginnen" is for the library. */
  showResume: boolean;
}) {
  const { t } = useI18n();
  const position = useReadingPosition(citekey);
  return (
    <div className="flex items-center gap-2">
      {showFetch ? (
        <Button size="sm" disabled={fetching} onClick={onFetch}>
          {fetching ? t("resolve.running") : t("resolve.button")}
        </Button>
      ) : null}
      {showResume ? (
        <Button size="sm" variant="primary" onClick={onResume}>
          {position
            ? t("reading.resume", { page: position.label ?? String(position.page + 1) })
            : t("reading.start")}
        </Button>
      ) : null}
    </div>
  );
}

/** One block of the overview: a 140px label column and the content, separated by an ink rule. */
function Section({
  title,
  note,
  id,
  children,
}: {
  title: string;
  note?: string;
  id?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      className="grid grid-cols-[140px_minmax(0,1fr)] gap-6 border-t border-line py-5"
    >
      <div className="flex flex-col gap-1 pt-1">
        <h2>
          <Label>{title}</Label>
        </h2>
        {note ? <span className="font-mono text-[11px] text-muted">{note}</span> : null}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

function familyName(c: { family: string } | { literal: string }): string {
  return "family" in c ? c.family : c.literal;
}

/** "Soziale Systeme. Grundriß ..." becomes "Soziale Systeme"; for the crumb in the top bar. */
function shortTitle(title: string): string {
  return title.split(/[.:?]/)[0]?.trim() || title;
}

/** One item: an overview (metadata, literature note) and a reading tab, with the cards in the right column. */
export function ItemView({
  citekey,
  tab = "overview",
  cardId,
  resume = false,
  onChange,
}: {
  citekey: string;
  tab?: ItemTab;
  /** The card open in the reader. */
  cardId?: string | undefined;
  /** Open the reader at the stored reading position. */
  resume?: boolean;
  onChange?: (next: {
    tab: ItemTab;
    card?: string | undefined;
    resume?: boolean | undefined;
  }) => void;
}) {
  const i18n = useI18n();
  const { t } = i18n;
  const item = useOp(itemsGet, { citekey });
  const cards = useOp(cardsList, itemCardsInput(citekey));
  const projects = useOp(projectsList, {});
  const trash = useTrashItem();
  const navigate = useNavigate();
  const resolve = useOpMutation(itemsResolve);
  const [editor, setEditor] = useState<"none" | "metadata" | "identifier">("none");
  const [notice, setNotice] = useState<Notice | null>(null);

  // another item, or the same one under a new citekey: start without the last message
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset when the citekey changes
  useEffect(() => {
    setEditor("none");
    setNotice(null);
  }, [citekey]);
  useEffect(() => {
    if (editor !== "none") {
      document.getElementById("item-metadata")?.scrollIntoView?.({ block: "start" });
    }
  }, [editor]);

  const fetchMetadata = () => {
    setNotice(null);
    resolve.mutate(
      { citekey },
      {
        onSuccess: (out) =>
          setNotice({
            text:
              out.changed.length > 0
                ? t("resolve.changed", { fields: out.changed.join(", ") })
                : t("resolve.unchanged"),
            ...(out.suggestedCitekey ? { suggested: out.suggestedCitekey } : {}),
          }),
        onError: (err) => {
          const offer = mergeOfferOf(err);
          setNotice({
            text: describeError(err).message,
            error: true,
            ...(offer ? { merge: offer } : {}),
          });
        },
      },
    );
  };

  if (item.isPending) return <Loading label={t("item.loading")} />;
  if (item.isError) return <ErrorState error={item.error} />;

  const { frontmatter: fm, note } = item.data;
  const fulltext = readNoFulltext(fm);
  const authors = (fm.author ?? []).map(creatorName);
  const retraction = markerOf(fm.retraction);
  const projectTitle = (slug: string) =>
    projects.data?.projects.find((p) => p.slug === slug)?.title ?? slug;
  const firstProject = fm.projects[0];
  const first = fm.author?.[0];
  const year = fm.issued !== undefined ? String(fm.issued).slice(0, 4) : undefined;
  const crumb = [first ? familyName(first) : undefined, year].filter(Boolean).join(" ");

  const thin = hasThinMetadata(fm);
  const pageCount = fm.sources.find((s) => s.pages)?.pages;
  const metaLine = [
    typeLabel(i18n, fm.type),
    [fm.publisher, year].filter(Boolean).join(" "),
    // A web page converts to one "page"; that count says nothing, so only documents show it.
    pageCount && pageCount > 1
      ? t("item.pageCount", { n: pageCount })
      : pageCount === 1 && fm.type !== "webpage"
        ? t("item.pageCountOne")
        : undefined,
    fm.language,
  ].filter(Boolean);

  const mono = new Set([t("meta.citekey"), "DOI", "ISBN"]);
  const meta: Array<[string, string | undefined]> = [
    [t("meta.citekey"), fm.citekey],
    [t("meta.type"), typeLabel(i18n, fm.type)],
    [t("meta.publishedIn"), fm["container-title"]],
    [t("meta.publisher"), fm.publisher],
    [t("meta.volume"), fm.volume],
    [t("meta.issue"), fm.issue],
    [t("meta.pages"), fm.page],
    ["DOI", fm.DOI],
    ["ISBN", fm.ISBN],
    [t("meta.language"), fm.language],
  ];

  const header = (
    <HeaderSlot>
      <nav
        aria-label={t("item.breadcrumb")}
        className="flex min-w-0 items-center gap-2 whitespace-nowrap text-muted"
      >
        {fm.inbox ? (
          <Link to="/inbox" className="hover:text-ink">
            {t("nav.inbox")}
          </Link>
        ) : (
          <Link to="/" search={{}} className="hover:text-ink">
            {t("nav.library")}
          </Link>
        )}
        {firstProject && !fm.inbox ? (
          <>
            <span aria-hidden="true">/</span>
            <Link to="/" search={{ project: firstProject }} className="hover:text-ink">
              {projectTitle(firstProject)}
            </Link>
          </>
        ) : null}
        <span aria-hidden="true">/</span>
        <span className="min-w-0 truncate font-medium text-ink">
          {[crumb, shortTitle(fm.title)].filter(Boolean).join(", ")}
        </span>
      </nav>
      <span className="flex-1" />
      {retraction ? <RetractionBadge marker={retraction} /> : null}
      <span className="font-mono text-[12px] text-muted">{fm.citekey}</span>
      {fm.inbox ? null : (
        <Button
          size="sm"
          onClick={() => {
            void trash(citekey).then((done) => {
              if (done) void navigate({ to: "/", search: {} });
            });
          }}
        >
          {t("item.delete")}
        </Button>
      )}
    </HeaderSlot>
  );

  const tabs = (
    <Segmented
      variant="tabs"
      label={t("item.tabs")}
      value={tab}
      onChange={(next) => onChange?.({ tab: next, card: cardId })}
      options={[
        { value: "overview", label: t("item.tabOverview") },
        { value: "read", label: t("item.tabRead") },
      ]}
    />
  );

  const renderColumn = (cardsContent: ReactNode, count: number) => (
    <RightColumn
      label={t("panel.title")}
      tabs={[
        { id: "cards", label: t("item.cards"), count, sunken: true, content: cardsContent },
        {
          id: "connections",
          label: t("connections.title"),
          content: (
            <div className="min-h-0 flex-1 overflow-y-auto p-4 [&>section]:mt-0">
              <ConnectionsPanel kind="item" id={citekey} />
            </div>
          ),
        },
      ]}
    />
  );

  if (tab === "read") {
    return (
      <>
        {header}
        {cards.isPending ? (
          <div className="flex h-full min-h-0">
            <div className="flex min-w-0 flex-1 flex-col">
              <SubBar>{tabs}</SubBar>
              <Loading label={t("item.loadingCards")} />
            </div>
            {renderColumn(null, item.data.cards)}
          </div>
        ) : cards.isError ? (
          <div className="flex h-full min-h-0">
            <div className="flex min-w-0 flex-1 flex-col">
              <SubBar>{tabs}</SubBar>
              <ErrorState error={cards.error} />
            </div>
            {renderColumn(null, item.data.cards)}
          </div>
        ) : (
          <ReaderTab
            fm={fm}
            cards={cards.data.cards}
            selectedId={cardId}
            onSelect={(id) => onChange?.({ tab: "read", card: id })}
            tabs={tabs}
            renderColumn={renderColumn}
            resume={resume}
          />
        )}
      </>
    );
  }

  const cardsContent = (
    <div className="flex min-h-0 flex-1 flex-col">
      {cards.data && cards.data.cards.length > 0 ? (
        <CardColumnBar cards={cards.data.cards} />
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {cards.isPending ? (
          <Loading label={t("item.loadingCards")} />
        ) : cards.isError ? (
          <ErrorState error={cards.error} />
        ) : cards.data.cards.length === 0 ? (
          <EmptyState
            icon={<Quote />}
            title={t("item.noCardsTitle")}
            description={t("item.noCardsDescription")}
          />
        ) : (
          <CardList
            cards={cards.data.cards}
            onOpen={(id) => onChange?.({ tab: "read", card: id })}
          />
        )}
      </div>
    </div>
  );

  return (
    <div className="flex h-full min-h-0">
      {header}
      <div className="flex min-w-0 flex-1 flex-col">
        <SubBar>
          {tabs}
          <OverviewActions
            citekey={citekey}
            onResume={() => onChange?.({ tab: "read", resume: true })}
            onFetch={fetchMetadata}
            fetching={resolve.isPending}
            showFetch={!thin}
            showResume={!fm.inbox}
          />
        </SubBar>
        <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-10 pt-11">
          <article className="mx-auto flex w-full max-w-[720px] flex-col">
            <header className="flex flex-col gap-2.5 pb-7">
              {retraction ? (
                <div className="mb-3">
                  <RetractionNote marker={retraction} />
                </div>
              ) : null}
              <InboxBanner fm={fm} />
              {notice ? (
                <div className="mb-1 flex flex-col gap-2">
                  <span
                    role={notice.error ? "alert" : "status"}
                    className={cn("text-[13px]", notice.error ? "text-danger" : "text-muted")}
                  >
                    {notice.text}
                  </span>
                  {notice.merge ? (
                    <MergeOfferNote
                      citekey={citekey}
                      offer={notice.merge}
                      onMerged={(text) => setNotice({ text })}
                    />
                  ) : null}
                  {notice.suggested ? (
                    <RenameOffer
                      citekey={citekey}
                      suggested={notice.suggested}
                      onClose={() => setNotice(null)}
                    />
                  ) : null}
                </div>
              ) : null}
              {thin ? (
                <MetadataHint
                  fetching={resolve.isPending}
                  onFetch={fetchMetadata}
                  onAddIdentifier={() => setEditor("identifier")}
                  onEdit={() => setEditor("metadata")}
                />
              ) : null}
              {fm.incomplete ? (
                <div
                  role="note"
                  aria-label={t("item.incomplete")}
                  className="flex flex-col gap-1 border border-danger px-3 py-2 text-[13px]"
                >
                  <span>
                    <Stamp tone="danger">{t("item.incomplete")}</Stamp> {t("item.incomplete.text")}
                  </span>
                  <span className="font-mono text-[12px] text-muted">
                    {fm.incomplete.code}: {fm.incomplete.message}
                  </span>
                </div>
              ) : null}
              {!fm.incomplete && fulltext ? (
                <div
                  role="note"
                  aria-label={t("item.noFulltext")}
                  className="flex flex-col gap-1 border border-line px-3 py-2 text-[13px]"
                >
                  <span>
                    <Stamp>{t("item.noFulltext")}</Stamp> {t("item.noFulltext.text")}
                  </span>
                  {fulltext.tried.length > 0 ? (
                    <span className="font-mono text-[12px] text-muted">
                      {t("item.noFulltext.tried")} {fulltext.tried.join(", ")}
                    </span>
                  ) : null}
                </div>
              ) : null}
              {fm.sources.length === 0 ? (
                <div className="mb-3">
                  <AttachPdf citekey={citekey} />
                </div>
              ) : null}
              <h1 className="font-serif text-[34px] font-medium leading-[1.15] tracking-[-0.01em]">
                {fm.title}
              </h1>
              {fm.subtitle ? (
                <p className="font-serif text-[18px] leading-[1.4] text-muted">{fm.subtitle}</p>
              ) : null}
              <p className="font-serif text-[18px] leading-[1.4]">
                {authors.length > 0 ? authors.join("; ") : t("item.unknownAuthor")}
                {fm.issued !== undefined ? (
                  <span className="text-muted"> ({String(fm.issued)})</span>
                ) : null}
              </p>
              <p className="text-muted">{metaLine.join(" · ")}</p>
              <div className="flex flex-wrap items-center gap-2 pt-1.5">
                <Badge tone={fm.status === "unread" ? "outline" : "accent"}>
                  <StatusSquare
                    filled={fm.status !== "unread"}
                    className={fm.status === "unread" ? "" : "border-bg bg-bg"}
                  />
                  {statusLabel(i18n, fm.status)}
                </Badge>
                <ProjectChips citekey={citekey} projects={fm.projects} />
                {fm.tags.map((tag) => (
                  <Badge key={tag}>{tag}</Badge>
                ))}
              </div>
            </header>

            {fm.abstract ? (
              <Section title={t("item.abstract")}>
                <p className="font-serif text-[16px] leading-[1.55]">{fm.abstract}</p>
              </Section>
            ) : null}

            <Section title={t("item.note")} note="Markdown">
              {note.trim() ? (
                <Prose text={note} size="sm" />
              ) : (
                <p className="text-muted">{t("item.noNote")}</p>
              )}
            </Section>

            <Section title={t("related.title")}>
              <RelatedWorks citekey={citekey} />
            </Section>

            <Section title={t("item.metadata")} id="item-metadata">
              {editor === "identifier" ? (
                <div className="mb-5">
                  <IdentifierForm
                    citekey={citekey}
                    onCancel={() => setEditor("none")}
                    onDone={(next) => {
                      setNotice(next);
                      setEditor("none");
                    }}
                  />
                </div>
              ) : null}
              {editor === "metadata" ? (
                <MetadataEditor
                  fm={fm}
                  onCancel={() => setEditor("none")}
                  onDone={(next) => {
                    setNotice(next);
                    setEditor("none");
                  }}
                />
              ) : (
                <dl className="grid grid-cols-[110px_minmax(0,1fr)_110px_minmax(0,1fr)] gap-x-4 gap-y-1.5">
                  {meta
                    .filter((row): row is [string, string] => Boolean(row[1]))
                    .map(([label, value]) => (
                      <div key={label} className="contents">
                        <dt className="text-muted">{label}</dt>
                        <dd
                          className={
                            mono.has(label)
                              ? "min-w-0 break-words font-mono text-[12px]"
                              : "min-w-0 break-words"
                          }
                        >
                          {value}
                        </dd>
                      </div>
                    ))}
                  {fm.URL ? (
                    <div className="contents">
                      <dt className="text-muted">URL</dt>
                      <dd className="min-w-0 break-all">
                        {webUrl(fm.URL) ? (
                          <a
                            href={webUrl(fm.URL)}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 underline"
                          >
                            {fm.URL}
                            <ExternalLink className="size-3" />
                          </a>
                        ) : (
                          fm.URL
                        )}
                      </dd>
                    </div>
                  ) : null}
                  {fm.sources.map((s) => (
                    <div key={s.hash} className="contents">
                      <dt className="text-muted">{t("item.file")}</dt>
                      <dd className="min-w-0 break-all font-mono text-[12px]">{s.filename}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {!thin && editor === "none" ? (
                <div className="mt-5 flex items-center gap-2">
                  <Button size="sm" onClick={() => setEditor("metadata")}>
                    {t("metaform.edit")}
                  </Button>
                  <Button size="sm" onClick={() => setEditor("identifier")}>
                    {t("metahint.addId")}
                  </Button>
                </div>
              ) : null}
            </Section>
          </article>
        </div>
      </div>
      {renderColumn(cardsContent, cards.data?.cards.length ?? item.data.cards)}
    </div>
  );
}
