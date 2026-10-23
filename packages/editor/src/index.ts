export const name = "@citegeist/editor";

export { filterSuggestions, wikiLinkAutocomplete, wikiLinkSource } from "./autocomplete";
export {
  createNoteEditor,
  type NoteEditor,
  type NoteEditorOptions,
  noteEditorAt,
} from "./editor";
export { buildDecorations } from "./live-preview";
export { type NoteEditorProps, NoteEditorView } from "./react";
export { frontmatterEnd, parseInner, scanWikiLinks, type WikiMatch } from "./scan";
export {
  type CardEmbed,
  DEFAULT_LABELS,
  type EditorLabels,
  type LinkKind,
  type OpenLinkEvent,
  type ResolvedLink,
  type Suggestion,
  type WikiLinkProvider,
} from "./types";
