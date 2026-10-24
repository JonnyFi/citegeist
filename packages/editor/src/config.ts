import { Facet, StateEffect } from "@codemirror/state";
import {
  type CitationProvider,
  DEFAULT_LABELS,
  type EditorLabels,
  type OpenLinkEvent,
  type WikiLinkProvider,
} from "./types";

export interface EditorConfig {
  provider: WikiLinkProvider | undefined;
  /** Pandoc citations (`[@key]`): completion after `@` and marks for unknown keys. Texts only. */
  citations?: CitationProvider | undefined;
  labels: EditorLabels;
  onOpenLink: ((event: OpenLinkEvent) => void) | undefined;
}

export const DEFAULT_CONFIG: EditorConfig = {
  provider: undefined,
  labels: DEFAULT_LABELS,
  onOpenLink: undefined,
};

/** Host-supplied settings. Held in a facet so widgets and the autocomplete read the current ones. */
export const configFacet = Facet.define<EditorConfig, EditorConfig>({
  combine: (values) => values[values.length - 1] ?? DEFAULT_CONFIG,
});

/** Recompute decorations, for example after the provider's data changed. */
export const refreshEffect = StateEffect.define<null>();

/** Open or close the folded frontmatter block. */
export const toggleFrontmatterEffect = StateEffect.define<boolean>();
