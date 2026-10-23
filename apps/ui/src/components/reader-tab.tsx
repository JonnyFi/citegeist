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
import { useCallback, useEffect, useMemo, useState } from "react";
import type { z } from "zod";
import { useI18n } from "../i18n";
import { AI_LANGUAGES, effectiveAiLanguage } from "../lib/ai-language";
import { useCardJobs } from "../lib/card-jobs";
import { anchorFromSelection, type CardsListOutput, itemCardsInput } from "../lib/cards";
import { useCore, useOp, useOpMutation } from "../lib/hooks";
import { describeError } from "../lib/utils";
import { CardPanel } from "./card-panel";
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
}: {
  fm: ItemFrontmatter;
  cards: CardsListOutput["cards"];
  selectedId: string | undefined;
  onSelect: (id: string | undefined) => void;
}) {
  const { t } = useI18n();
  const assets = useOp(documentsAssets, { citekey: fm.citekey });

  if (assets.isPending) return <Loading label={t("reader.loading")} />;
  if (assets.isError) {
    return (
      <EmptyState
        icon={<FileX className="size-6" />}
        title={t("reader.unavailableTitle")}
        description={`${t("reader.unavailableDescription")} ${describeError(assets.error).message}`}
      />
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
    />
  );
}

function ReaderLoaded({
  fm,
  data,
  cards,
  selectedId,
  onSelect,
}: {
  fm: ItemFrontmatter;
  data: DocumentAssets;
  cards: CardsListOutput["cards"];
  selectedId: string | undefined;
  onSelect: (id: string | undefined) => void;
}) {
  const { t } = useI18n();
  const core = useCore();
  const queryClient = useQueryClient();
  hideReaderPopover();

  const [view, setView] = useState<View>(data.pdfUrl ? "pdf" : "reflow");
  const [selection, setSelection] = useState<Selection | null>(null);
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

  const highlights = useMemo<ReaderHighlight[]>(
    () =>
      cards.map((c) => ({
        id: c.frontmatter.id,
        anchor: { pdf: c.frontmatter.anchor.pdf, text: c.frontmatter.anchor.text },
        ...(c.frontmatter.id === selectedId ? { color: "rgba(255, 150, 0, 0.55)" } : {}),
      })),
    [cards, selectedId],
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

  const onSelectionChange = useCallback((anchors: SelectionAnchors | null) => {
    const sel = window.getSelection();
    if (!anchors || !sel || sel.rangeCount === 0) {
      setSelection(null);
      return;
    }
    setSelection({ anchors, range: sel.getRangeAt(0).cloneRange() });
  }, []);

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
      <div className="flex min-w-0 flex-1 flex-col">
        {data.pages && !data.pages.confirmed ? (
          <PageBanner citekey={fm.citekey} pages={data.pages} />
        ) : null}
        <ReaderToolbar
          language={language.value}
          languages={languages}
          languageLabel={`${t("reader.aiLanguage")} (${t(`origin.${language.origin}`)})`}
          onLanguageChange={(value) =>
            setLanguage.mutate({ citekey: fm.citekey, patch: { ai_language: value } })
          }
        >
          {views.length > 0 ? (
            <Segmented label={t("reader.view")} value={view} onChange={setView} options={views} />
          ) : null}
        </ReaderToolbar>
        <div className="min-h-0 flex-1">
          {view === "pdf" ? (
            pdf.data ? (
              <PdfView data={pdf.data} source={data.source} pageLabels={pageLabels} {...shared} />
            ) : pdf.isError ? (
              <EmptyState
                icon={<FileX className="size-6" />}
                title={t("reader.pdfFailed")}
                description={describeError(pdf.error).message}
              />
            ) : (
              <Loading label={t("reader.loadingPdf")} />
            )
          ) : data.html ? (
            <ReflowView html={data.html} {...shared} />
          ) : (
            <EmptyState icon={<FileX className="size-6" />} title={t("reader.noView")} />
          )}
        </div>
      </div>
      <aside className="flex w-[26rem] shrink-0 flex-col border-l border-line bg-sunken/30">
        <CardPanel
          cards={cards}
          selectedId={selectedId}
          onSelect={onSelect}
          jobs={jobs}
          onJob={track}
          defaultLanguage={language.value}
          orphaned={orphaned}
        />
      </aside>
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
          className="fixed bottom-4 left-1/2 -translate-x-1/2 rounded-md bg-danger px-3 py-2 text-white"
        >
          {describeError(create.error).message}
        </p>
      ) : null}
      {watchers}
    </div>
  );
}
