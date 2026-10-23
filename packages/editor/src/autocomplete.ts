import {
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";
import { configFacet } from "./config";
import type { EditorLabels, Suggestion } from "./types";

const TRIGGER = /!?\[\[[^[\]\n|#]*$/;

function rank(s: Suggestion, q: string): number {
  const target = s.target.toLowerCase();
  const label = s.label.toLowerCase();
  if (q === "") return 3;
  if (target.startsWith(q)) return 0;
  if (label.startsWith(q)) return 1;
  if (target.includes(q)) return 2;
  if (label.includes(q) || (s.detail ?? "").toLowerCase().includes(q)) return 3;
  return -1;
}

/**
 * Filters and orders suggestions for the text typed after `[[`: prefix of the target first, then
 * prefix of the title, then substrings. Hosts use it inside `WikiLinkProvider.suggest`.
 */
export function filterSuggestions(
  all: readonly Suggestion[],
  query: string,
  limit = 30,
): Suggestion[] {
  const q = query.trim().toLowerCase();
  return all
    .map((s, i) => ({ s, i, r: rank(s, q) }))
    .filter((x) => x.r >= 0)
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.s);
}

function sections(
  labels: EditorLabels,
): Record<Suggestion["kind"], { name: string; rank: number }> {
  return {
    item: { name: labels.sectionItem, rank: 0 },
    note: { name: labels.sectionNote, rank: 1 },
    card: { name: labels.sectionCard, rank: 2 },
  };
}

/** The completion source for `[[` and `![[`. Exported so tests and hosts can call it directly. */
export async function wikiLinkSource(context: CompletionContext): Promise<CompletionResult | null> {
  const match = context.matchBefore(TRIGGER);
  if (!match) return null;
  const { provider, labels } = context.state.facet(configFacet);
  const section = sections(labels);
  if (!provider) return null;
  const embed = match.text.startsWith("!");
  const from = match.from + (embed ? 3 : 2);
  const query = context.state.sliceDoc(from, context.pos);
  const found = await provider.suggest(query, { embed });
  if (context.aborted) return null;
  const options: Completion[] = found.map((s) => ({
    label: s.target,
    displayLabel: s.target,
    detail: s.label,
    ...(s.detail ? { info: s.detail } : {}),
    type: s.kind,
    section: section[s.kind],
    apply(view, _completion, applyFrom, applyTo) {
      const after = view.state.sliceDoc(applyTo, applyTo + 2);
      const closes = after === "]]";
      view.dispatch({
        changes: { from: applyFrom, to: applyTo, insert: closes ? s.target : `${s.target}]]` },
        selection: { anchor: applyFrom + s.target.length + 2 },
        userEvent: "input.complete",
      });
    },
  }));
  return { from, options, filter: false };
}

export const wikiLinkAutocomplete: Extension = autocompletion({
  override: [wikiLinkSource],
  activateOnTyping: true,
  icons: false,
  closeOnBlur: true,
});
