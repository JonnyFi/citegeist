import type { NoteEditor } from "@citegeist/editor";
import { textsGet, textsUpdate } from "@citegeist/ops";
import { scanCitations } from "@citegeist/schema";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../components/ui/button";
import { Select } from "../components/ui/select";
import { ErrorState, Loading } from "../components/ui/states";
import { type MessageKey, useI18n } from "../i18n";
import { SaveStatus, useDocAutosave } from "../lib/autosave";
import { useCore, useOp, useOpMutation } from "../lib/hooks";
import { EditorField } from "../notes/editor-field";
import { useLibraryLinks } from "../notes/library-links";
import { publishOpenText, registerInserter } from "./active";
import { useCitationProvider } from "./citations";
import { detectPlainCitations } from "./detect";
import { ExportBar, PandocBanner } from "./export-bar";

const STYLES = ["apa", "chicago-author-date", "deutsche-gesellschaft-fur-psychologie"] as const;
const LANGS = ["de-DE", "de-AT", "en-US", "en-GB"] as const;
const PROJECT = "project";

function styleLabel(t: (key: MessageKey) => string, id: string): string {
  return (STYLES as readonly string[]).includes(id) ? t(`texts.style.${id}` as MessageKey) : id;
}

function TextBody({
  project,
  text,
  title,
  path,
  initial,
  style,
  lang,
  projectStyle,
  projectLang,
  resolved,
}: {
  project: string;
  text: string;
  title: string;
  path: string;
  initial: { body: string; hash: string };
  style: string | undefined;
  lang: string | undefined;
  projectStyle: string;
  projectLang: string;
  /** The style and language an export uses: the text's own, else the project's. */
  resolved: { style: string; lang: string };
}) {
  const { t, tn } = useI18n();
  const core = useCore();
  const editorRef = useRef<NoteEditor | null>(null);
  // The chips show the citations in this style and language, so a change in the dropdowns restyles them.
  const citations = useCitationProvider(
    { project, style: resolved.style, lang: resolved.lang },
    () => editorRef.current?.refresh(),
  );
  const links = useLibraryLinks();
  const update = useOpMutation(textsUpdate);
  const [draft, setDraft] = useState(initial.body);
  const save = useDocAutosave(
    (body, baseHash) => core.call(textsUpdate, { project, text, body, baseHash }),
    initial,
    draft,
    setDraft,
  );

  // The card actions and the chat know which text is open.
  useEffect(() => {
    publishOpenText({ project, text, title, lang: resolved.lang });
    registerInserter((snippet) => editorRef.current?.insert(snippet));
    return () => {
      registerInserter(null);
      publishOpenText(null);
    };
  }, [project, text, title, resolved.lang]);

  const unknown = useMemo(() => {
    if (!citations) return [];
    return [
      ...new Set(
        scanCitations(draft)
          .filter((c) => !citations.resolve(c.key))
          .map((c) => c.key),
      ),
    ];
  }, [draft, citations]);

  // Citations that stand as plain text, such as "(Luhmann, 1984, S. 31)", can become Pandoc citations.
  const plain = useMemo(
    () =>
      links.index ? detectPlainCitations(draft, links.index.items.values(), resolved.lang) : [],
    [draft, links.index, resolved.lang],
  );
  const [confirmingPlain, setConfirmingPlain] = useState(false);
  const convertPlain = () => {
    setConfirmingPlain(false);
    editorRef.current?.replaceRanges(
      plain.map((c) => ({ from: c.from, to: c.to, insert: c.replacement })),
    );
  };

  const styleOptions = [
    {
      value: PROJECT,
      label: t("texts.sameAsProject", { value: styleLabel(t, projectStyle) }),
    },
    ...STYLES.map((s) => ({ value: s, label: t(`texts.style.${s}` as MessageKey) })),
  ];
  const langOptions = [
    {
      value: PROJECT,
      label: t("texts.sameAsProject", {
        value: LANGS.includes(projectLang as (typeof LANGS)[number])
          ? t(`texts.lang.${projectLang}` as MessageKey)
          : projectLang,
      }),
    },
    ...LANGS.map((l) => ({ value: l, label: t(`texts.lang.${l}` as MessageKey) })),
  ];

  // A change of style or language rewrites the frontmatter, so pending text goes first.
  const patch = async (change: { style?: string; lang?: string }) => {
    await save.flush();
    update.mutate({ project, text, ...change });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-4">
      <PandocBanner />
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[12px] text-muted">{t("texts.style")}</span>
          <Select
            label={t("texts.style")}
            value={style ?? PROJECT}
            onChange={(v) => void patch({ style: v === PROJECT ? "" : v })}
            options={styleOptions}
            className="min-w-52"
          />
          <span className="text-[12px] text-muted">{t("texts.lang")}</span>
          <Select
            label={t("texts.lang")}
            value={lang ?? PROJECT}
            onChange={(v) => void patch({ lang: v === PROJECT ? "" : v })}
            options={langOptions}
            className="min-w-52"
          />
        </div>
        <ExportBar project={project} text={text} beforeExport={() => save.flush()} />
      </div>
      <div className="mb-2 flex items-center justify-between gap-3 text-[12px] text-muted">
        <span className="font-mono">{path}</span>
        <span className="flex items-center gap-3">
          {plain.length > 0 && !confirmingPlain ? (
            <Button size="sm" onClick={() => setConfirmingPlain(true)}>
              {t("texts.detect.button", { n: plain.length })}
            </Button>
          ) : null}
          <SaveStatus save={save} keepMine={t("texts.keepMine")} />
        </span>
      </div>
      {plain.length > 0 && confirmingPlain ? (
        <section
          aria-label={t("texts.detect.region")}
          className="mb-2 flex flex-wrap items-center gap-3 border border-line bg-sunken px-3 py-2 text-[12px]"
        >
          <p className="min-w-0 flex-1">
            {tn("texts.detect.question", plain.length, { example: plain[0]?.text ?? "" })}
          </p>
          <Button size="sm" variant="primary" onClick={convertPlain}>
            {t("texts.detect.apply")}
          </Button>
          <Button size="sm" onClick={() => setConfirmingPlain(false)}>
            {t("texts.detect.cancel")}
          </Button>
        </section>
      ) : null}
      {unknown.length > 0 ? (
        <p role="status" data-testid="unknown-citekeys" className="mb-2 text-[12px] text-danger">
          {tn("texts.unknown", unknown.length, { keys: unknown.join(", ") })}
        </p>
      ) : null}
      <EditorField
        value={draft}
        onChange={setDraft}
        provider={undefined}
        citations={citations}
        editorRef={editorRef}
        index={undefined}
        label={title}
        placeholder={t("texts.placeholder")}
        className="note-editor min-h-96"
      />
    </div>
  );
}

/** One text in the editor with Pandoc citations, autosave, style and language, and the export. */
export function TextView({
  project,
  text,
  projectStyle,
  projectLang,
}: {
  project: string;
  text: string;
  projectStyle: string;
  projectLang: string;
}) {
  const { t } = useI18n();
  const read = useOp(textsGet, { project, text });
  if (read.isPending) return <Loading label={t("texts.loadingText")} />;
  if (read.isError) return <ErrorState error={read.error} />;
  return (
    <TextBody
      key={text}
      project={project}
      text={text}
      title={read.data.title}
      path={read.data.path}
      initial={{ body: read.data.body, hash: read.data.hash }}
      style={read.data.style}
      lang={read.data.lang}
      projectStyle={projectStyle}
      projectLang={projectLang}
      resolved={read.data.resolved}
    />
  );
}
