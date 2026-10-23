import { completionKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { Annotation, Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap, placeholder as placeholderExt } from "@codemirror/view";
import { wikiLinkAutocomplete } from "./autocomplete";
import { configFacet, DEFAULT_CONFIG, type EditorConfig, refreshEffect } from "./config";
import { livePreview } from "./live-preview";
import { noteTheme } from "./theme";
import type { EditorLabels, OpenLinkEvent, WikiLinkProvider } from "./types";

/** Marks transactions that come from `setValue`, so they do not call `onChange`. */
const external = Annotation.define<boolean>();

export interface NoteEditorOptions {
  parent: HTMLElement;
  /** Markdown text. Whatever is not edited comes back from `getValue` unchanged, byte for byte. */
  value: string;
  provider?: WikiLinkProvider;
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
    labels?: Partial<EditorLabels>;
    onOpenLink?: ((event: OpenLinkEvent) => void) | undefined;
  }): void;
  /** Recomputes link styling after the provider's data changed. */
  refresh(): void;
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
    labels: { ...DEFAULT_CONFIG.labels, ...options.labels },
    onOpenLink: options.onOpenLink,
  };
  const configCompartment = new Compartment();
  const onChange = options.onChange;

  const extensions = (): Extension[] => [
    configCompartment.of(configFacet.of(config)),
    history(),
    pairWikiBrackets,
    keymap.of([...completionKeymap, ...defaultKeymap, ...historyKeymap]),
    markdown({ base: markdownLanguage }),
    livePreview,
    wikiLinkAutocomplete,
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
        labels: { ...config.labels, ...patch.labels },
        onOpenLink: "onOpenLink" in patch ? patch.onOpenLink : config.onOpenLink,
      };
      view.dispatch({ effects: configCompartment.reconfigure(configFacet.of(config)) });
    },
    refresh() {
      view.dispatch({ effects: refreshEffect.of(null) });
    },
    focus: () => view.focus(),
    destroy: () => view.destroy(),
  };
  instances.set(view.dom, editor);
  return editor;
}
