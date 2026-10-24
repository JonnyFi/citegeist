import { buildBlockStream } from "@citegeist/anchoring";
import { cardsCreate, cardsList, documentsAssets, itemsUpdate, projectsList } from "@citegeist/ops";
import {
  type HighlightStatus,
  PdfView,
  type ReaderHighlight,
  ReaderToolbar,
  ReflowView,
  type SelectionAnchors,
} from "@citegeist/reader";
import type { ItemFrontmatter } from "@citegeist/schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileX } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import type { z } from "zod";
import { publishChatSelection } from "../chat";
import { useI18n } from "../i18n";
import { AI_LANGUAGES, effectiveAiLanguage } from "../lib/ai-language";
import { useCardJobs } from "../lib/card-jobs";
import { anchorFromSelection, type CardsListOutput, itemCardsInput, kindColor } from "../lib/cards";
import { useCore, useOp, useOpMutation } from "../lib/hooks";
import { loadReadingPosition, restoreReading, trackReading } from "../lib/reading-position";
import { describeError } from "../lib/utils";
import { AttachPdf } from "./attach-pdf";
import { CardList } from "./card-list";
import { CardPanel } from "./card-panel";
import { SubBar } from "./layout";
import { PageBanner } from "./page-banner";
import { hideReaderPopover, SelectionActions } from "./selection-actions";
import { Segmented } from "./ui/segmented";
import { EmptyState, Loading } from "./ui/states";

type DocumentAssets = z.output<typeof documentsAssets.output>;

type View = "pdf" | "reflow";

interface Selection {
  anchors: SelectionAnchors;
  range: Range;
}

/** Item page, reading tab: the source in PDF or reflow view, its cards as highlights, and the card panel. */
export function ReaderTab({
  fm,
  cards,
  selectedId,
  onSelect,
  tabs,
  renderColumn,
  resume = false,
}: {
  fm: ItemFrontmatter;
  cards: CardsListOutput["cards"];
  selectedId: string | undefined;
  onSelect: (id: string | undefined) => void;
  /** Pick up at the stored reading position ("Weiterlesen"). */
  resume?: boolean;
  /** The Übersicht/Lesen tab row, drawn at the left of the sub bar. */
  tabs: ReactNode;
  /** The right column around the given card panel; the item view adds its other tabs. */
  renderColumn: (cardsContent: ReactNode, count: number) => ReactNode;
}) {
  const { t } = useI18n();
  const assets = useOp(documentsAssets, { citekey: fm.citekey });

  if (assets.isPending || assets.isError) {
    return (
      <div className="flex h-full min-h-0">
        <div className="flex min-w-0 flex-1 flex-col">
          <SubBar>{tabs}</SubBar>
          {assets.isPending ? (
            <Loading label={t("reader.loading")} />
          ) : (
            <EmptyState
              icon={<FileX />}
              title={t("reader.unavailableTitle")}
              description={`${t("reader.unavailableDescription")} ${describeError(assets.error).message}`}
              {...(fm.sources.length === 0
                ? { action: <AttachPdf citekey={fm.citekey} variant="button" /> }
                : {})}
            />
          )}
        </div>
        {renderColumn(
          <div className="min-h-0 flex-1 overflow-y-auto">
            <CardList cards={cards} onOpen={(id) => onSelect(id)} />
          </div>,
          cards.length,
        )}
      </div>
    );
  }
  return (
    <ReaderLoaded
      key={assets.data.source}
      fm={fm}
      data={assets.data}
      cards={cards}
      selectedId={selectedId}
      onSelect={onSelect}
      tabs={tabs}
      renderColumn={renderColumn}
      resume={resume}
    />
  );
}

function ReaderLoaded({
  fm,
  data,
  cards,
  selectedId,
  onSelect,
  tabs,
  renderColumn,
  resume,
}: {
  fm: ItemFrontmatter;
  data: DocumentAssets;
  resume: boolean;
  cards: CardsListOutput["cards"];
  selectedId: string | undefined;
  onSelect: (id: string | undefined) => void;
  tabs: ReactNode;
  renderColumn: (cardsContent: ReactNode, count: number) => ReactNode;
}) {
  const { t } = useI18n();
  const core = useCore();
  const queryClient = useQueryClient();
  hideReaderPopover();

  const [view, setView] = useState<View>(data.pdfUrl ? "pdf" : "reflow");
  const [selection, setSelection] = useState<Selection | null>(null);
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [statuses, setStatuses] = useState<Record<string, HighlightStatus>>({});
  const { jobs, track, watchers } = useCardJobs();

  const pdfUrl = data.pdfUrl ? core.fileUrl(data.pdfUrl) : undefined;
  const pdf = useQuery({
    queryKey: ["file", pdfUrl],
    enabled: view === "pdf" && pdfUrl !== undefined,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 5 * 60_000,
    queryFn: async () => {
      const res = await fetch(pdfUrl ?? "");
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      return new Uint8Array(await res.arrayBuffer());
    },
  });

  const stream = useMemo(() => buildBlockStream(data.blocks), [data.blocks]);
  const pageLabels = useMemo(() => data.pages?.pages.map((p) => p.label), [data.pages]);

  // remember where Jonny stopped; "Weiterlesen" on the overview comes back to it
  useEffect(
    () =>
      host ? trackReading(host, fm.citekey, (page) => pageLabels?.[page] ?? undefined) : undefined,
    [host, fm.citekey, pageLabels],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: picks up once per opened view
  useEffect(() => {
    if (!resume || selectedId || !host) return;
    const position = loadReadingPosition(fm.citekey);
    return position ? restoreReading(host, position) : undefined;
  }, [resume, host, view]);

  const highlights = useMemo<ReaderHighlight[]>(
    () =>
      cards.map((c) => ({
        id: c.frontmatter.id,
        anchor: { pdf: c.frontmatter.anchor.pdf, text: c.frontmatter.anchor.text },
        color: kindColor(c.frontmatter.kind),
      })),
    [cards],
  );
  const orphaned = useMemo(
    () =>
      new Set(
        Object.entries(statuses)
          .filter(([, s]) => s === "orphaned")
          .map(([id]) => id),
      ),
    [statuses],
  );

  // D9: the dropdown shows what the core will use for this source and writes the item's own setting
  const projects = useOp(projectsList, {});
  const projectLanguages = useMemo(
    () => new Map((projects.data?.projects ?? []).map((p) => [p.slug, p.ai_language])),
    [projects.data],
  );
  const language = effectiveAiLanguage(fm, projectLanguages);
  const setLanguage = useOpMutation(itemsUpdate);
  const languages = useMemo(() => {
    const values: string[] = [...AI_LANGUAGES];
    if (!values.includes(language.value)) values.push(language.value);
    return values.map((value) => ({
      value,
      label: (AI_LANGUAGES as readonly string[]).includes(value)
        ? t(`aiLang.${value as (typeof AI_LANGUAGES)[number]}`)
        : value,
    }));
  }, [language.value, t]);

  const create = useMutation({
    mutationFn: (anchors: SelectionAnchors) =>
      core.call(cardsCreate, {
        citekey: fm.citekey,
        anchor: anchorFromSelection(anchors),
        quote: anchors.quote,
      }),
    onSuccess: ({ card, job }) => {
      // the card shows up at once; the AI texts follow when the job is done
      queryClient.setQueryData<CardsListOutput>(
        ["op", cardsList.name, itemCardsInput(fm.citekey)],
        (old) =>
          old
            ? {
                ...old,
                cards: [...old.cards.filter((c) => c.frontmatter.id !== card.frontmatter.id), card],
              }
            : old,
      );
      if (job) track(card.frontmatter.id, job);
      onSelect(card.frontmatter.id);
      setSelection(null);
      window.getSelection()?.removeAllRanges();
      void queryClient.invalidateQueries({ queryKey: ["op"] });
    },
  });

  const onSelectionChange = useCallback(
    (anchors: SelectionAnchors | null) => {
      const sel = window.getSelection();
      if (!anchors || !sel || sel.rangeCount === 0) {
        setSelection(null);
        publishChatSelection(null);
        return;
      }
      setSelection({ anchors, range: sel.getRangeAt(0).cloneRange() });
      // the chat shows the marked passage as a context chip
      const page = anchors.location.first?.label;
      publishChatSelection({
        citekey: fm.citekey,
        text: anchors.quote.slice(0, 8000),
        ...(page ? { page } : {}),
      });
    },
    [fm.citekey],
  );
  useEffect(() => () => publishChatSelection(null), []);

  // bring the selected card's highlight into view in whichever view is open
  // biome-ignore lint/correctness/useExhaustiveDependencies: view change re-places the highlights
  useEffect(() => {
    if (!selectedId) return;
    const timer = setTimeout(() => {
      document
        .querySelector(`[data-highlight-id="${selectedId}"]`)
        ?.scrollIntoView({ block: "center" });
    }, 50);
    return () => clearTimeout(timer);
  }, [selectedId, view]);

  const views = [
    ...(data.pdfUrl ? [{ value: "pdf" as const, label: t("reader.viewPdf") }] : []),
    ...(data.html ? [{ value: "reflow" as const, label: t("reader.viewReflow") }] : []),
  ];

  const shared = {
    stream,
    highlights,
    onSelectionChange,
    onHighlightClick: (id: string) => onSelect(id),
    onHighlightsResolved: setStatuses,
  };

  return (
    <div className="flex h-full min-h-0">
      {/* the card of the open selection gets a soft fill behind its underline */}
      {selectedId ? (
        <style>{`[data-highlight-id="${selectedId}"]{background-color:var(--line-soft);box-shadow:0 0 0 2px var(--line-soft)}`}</style>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col">
        <ReaderToolbar
          language={language.value}
          languages={languages}
          languageLabel={`${t("reader.aiLanguage")} (${t(`origin.${language.origin}`)})`}
          onLanguageChange={(value) =>
            setLanguage.mutate({ citekey: fm.citekey, patch: { ai_language: value } })
          }
        >
          {tabs}
          {views.length > 0 ? (
            <Segmented
              label={t("reader.view")}
              value={view}
              onChange={setView}
              options={views}
              className="cg-view-switch"
            />
          ) : null}
        </ReaderToolbar>
        {data.pages && !data.pages.confirmed ? (
          <PageBanner citekey={fm.citekey} pages={data.pages} />
        ) : null}
        <div ref={setHost} className="min-h-0 flex-1">
          {view === "pdf" ? (
            pdf.data ? (
              <PdfView data={pdf.data} source={data.source} pageLabels={pageLabels} {...shared} />
            ) : pdf.isError ? (
              <EmptyState
                icon={<FileX />}
                title={t("reader.pdfFailed")}
                description={describeError(pdf.error).message}
              />
            ) : (
              <Loading label={t("reader.loadingPdf")} />
            )
          ) : data.html ? (
            <ReflowView html={data.html} {...shared} />
          ) : (
            <EmptyState icon={<FileX />} title={t("reader.noView")} />
          )}
        </div>
      </div>
      {renderColumn(
        <CardPanel
          cards={cards}
          selectedId={selectedId}
          onSelect={onSelect}
          jobs={jobs}
          onJob={track}
          defaultLanguage={language.value}
          orphaned={orphaned}
        />,
        cards.length,
      )}
      {selection ? (
        <SelectionActions
          range={selection.range}
          busy={create.isPending}
          onQuote={() => create.mutate(selection.anchors)}
        />
      ) : null}
      {create.error ? (
        <p
          role="alert"
          className="fixed bottom-4 left-1/2 -translate-x-1/2 border border-danger bg-bg px-3 py-2 text-danger"
        >
          {describeError(create.error).message}
        </p>
      ) : null}
      {watchers}
    </div>
  );
}
