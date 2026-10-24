import { completionKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { Annotation, Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap, placeholder as placeholderExt } from "@codemirror/view";
import { wikiLinkAutocomplete } from "./autocomplete";
import { citationMarks } from "./citations";
import { configFacet, DEFAULT_CONFIG, type EditorConfig, refreshEffect } from "./config";
import { livePreview } from "./live-preview";
import { noteTheme } from "./theme";
import type { CitationProvider, EditorLabels, OpenLinkEvent, WikiLinkProvider } from "./types";

/** Marks transactions that come from `setValue`, so they do not call `onChange`. */
const external = Annotation.define<boolean>();

export interface NoteEditorOptions {
  parent: HTMLElement;
  /** Markdown text. Whatever is not edited comes back from `getValue` unchanged, byte for byte. */
  value: string;
  provider?: WikiLinkProvider;
  /** Turns on Pandoc citations: completion after `@` and marks for unknown citekeys. */
  citations?: CitationProvider;
  labels?: Partial<EditorLabels>;
  /** Called after every edit made in the editor, not after `setValue`. */
  onChange?: (value: string) => void;
  /** Called when the user opens a wiki link or an embedded card. */
  onOpenLink?: (event: OpenLinkEvent) => void;
  readOnly?: boolean;
  placeholder?: string;
  ariaLabel?: string;
}

export interface NoteEditor {
  readonly view: EditorView;
  getValue(): string;
  /** Replaces the text, touching only the part that differs so cursor and undo history survive. */
  setValue(value: string): void;
  /** Swaps provider, labels or callbacks. */
  configure(patch: {
    provider?: WikiLinkProvider | undefined;
    citations?: CitationProvider | undefined;
    labels?: Partial<EditorLabels>;
    onOpenLink?: ((event: OpenLinkEvent) => void) | undefined;
  }): void;
  /** Recomputes link styling after the provider's data changed. */
  refresh(): void;
  /**
   * Writes `text` at the cursor, replacing a selection. An editor nobody has clicked into yet
   * takes the text at the end, in a paragraph of its own, rather than at the top.
   */
  insert(text: string): void;
  focus(): void;
  destroy(): void;
}

/** CRLF files keep their line endings: the separator is whatever the text uses. */
function separatorOf(text: string): string {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

/** Typing a second `[` completes the pair, so `[[` becomes `[[]]` with the cursor inside. */
const pairWikiBrackets = EditorView.inputHandler.of((view, from, to, text) => {
  if (text !== "[" || from !== to || from === 0 || view.state.readOnly) return false;
  if (view.state.sliceDoc(from - 1, from) !== "[" || view.state.sliceDoc(from, from + 2) === "]]")
    return false;
  view.dispatch({
    changes: { from, insert: "[]]" },
    selection: { anchor: from + 1 },
    userEvent: "input.type",
  });
  return true;
});

function openLinkHandler() {
  return EditorView.domEventHandlers({
    mousedown(event, view) {
      const node = event.target instanceof Element ? event.target.closest(".cm-wikilink") : null;
      if (!(node instanceof HTMLElement) || !node.dataset.target) return false;
      const rawText = node.classList.contains("cm-wikilink-raw");
      if (rawText && !(event.metaKey || event.ctrlKey)) return false;
      const open = view.state.facet(configFacet).onOpenLink;
      if (!open) return false;
      event.preventDefault();
      open({
        target: node.dataset.target,
        embed: node.dataset.embed === "true",
        ...(node.dataset.anchor ? { anchor: node.dataset.anchor } : {}),
      });
      return true;
    },
  });
}

const instances = new WeakMap<Element, NoteEditor>();

/** The editor that renders inside `el` (any element within it), for hosts and tests. */
export function noteEditorAt(el: Element | null): NoteEditor | undefined {
  const root = el?.closest(".cm-editor");
  return root ? instances.get(root) : undefined;
}

export function createNoteEditor(options: NoteEditorOptions): NoteEditor {
  let config: EditorConfig = {
    ...DEFAULT_CONFIG,
    provider: options.provider,
    citations: options.citations,
    labels: { ...DEFAULT_CONFIG.labels, ...options.labels },
    onOpenLink: options.onOpenLink,
  };
  const configCompartment = new Compartment();
  /** True once the person edited or moved the cursor, so `insert` knows where they are. */
  let touched = false;
  const onChange = options.onChange;

  const extensions = (): Extension[] => [
    configCompartment.of(configFacet.of(config)),
    history(),
    pairWikiBrackets,
    keymap.of([...completionKeymap, ...defaultKeymap, ...historyKeymap]),
    markdown({ base: markdownLanguage }),
    livePreview,
    wikiLinkAutocomplete,
    citationMarks,
    openLinkHandler(),
    EditorView.lineWrapping,
    noteTheme,
    EditorView.contentAttributes.of({
      ...(options.ariaLabel ? { "aria-label": options.ariaLabel } : {}),
      "aria-multiline": "true",
    }),
    ...(options.placeholder ? [placeholderExt(options.placeholder)] : []),
    ...(options.readOnly ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : []),
    EditorView.updateListener.of((update) => {
      const own = !update.transactions.some((t) => t.annotation(external));
      if (own && (update.docChanged || update.selectionSet)) touched = true;
      if (
        update.docChanged &&
        onChange &&
        !update.transactions.some((t) => t.annotation(external))
      ) {
        onChange(update.state.sliceDoc());
      }
    }),
  ];

  const stateFor = (value: string) =>
    EditorState.create({
      doc: value,
      extensions: [EditorState.lineSeparator.of(separatorOf(value)), ...extensions()],
    });

  const view = new EditorView({ parent: options.parent, state: stateFor(options.value) });

  const editor: NoteEditor = {
    view,
    getValue: () => view.state.sliceDoc(),
    setValue(value) {
      const current = view.state.sliceDoc();
      if (value === current) return;
      // With CRLF the string offsets differ from document offsets, so that case swaps the state.
      if (separatorOf(value) !== view.state.lineBreak || view.state.lineBreak !== "\n") {
        view.setState(stateFor(value));
        return;
      }
      let start = 0;
      const max = Math.min(current.length, value.length);
      while (start < max && current.charCodeAt(start) === value.charCodeAt(start)) start++;
      let endCur = current.length;
      let endNew = value.length;
      while (
        endCur > start &&
        endNew > start &&
        current.charCodeAt(endCur - 1) === value.charCodeAt(endNew - 1)
      ) {
        endCur--;
        endNew--;
      }
      view.dispatch({
        changes: { from: start, to: endCur, insert: value.slice(start, endNew) },
        annotations: external.of(true),
      });
    },
    configure(patch) {
      config = {
        provider: "provider" in patch ? patch.provider : config.provider,
        citations: "citations" in patch ? patch.citations : config.citations,
        labels: { ...config.labels, ...patch.labels },
        onOpenLink: "onOpenLink" in patch ? patch.onOpenLink : config.onOpenLink,
      };
      view.dispatch({ effects: configCompartment.reconfigure(configFacet.of(config)) });
    },
    refresh() {
      view.dispatch({ effects: refreshEffect.of(null) });
    },
    insert(text) {
      const doc = view.state.doc;
      if (touched || view.hasFocus || doc.length === 0) {
        view.dispatch({
          ...view.state.replaceSelection(text),
          scrollIntoView: true,
          userEvent: "input.paste",
        });
        return;
      }
      const tail = doc.sliceString(Math.max(0, doc.length - 2));
      const gap = tail.endsWith("\n\n") ? "" : tail.endsWith("\n") ? "\n" : "\n\n";
      const at = doc.length;
      view.dispatch({
        changes: { from: at, insert: `${gap}${text}\n` },
        selection: { anchor: at + gap.length + text.length },
        scrollIntoView: true,
        userEvent: "input.paste",
      });
      touched = true;
    },
    focus: () => view.focus(),
    destroy: () => view.destroy(),
  };
  instances.set(view.dom, editor);
  return editor;
}
