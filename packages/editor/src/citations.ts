import { scanCitations } from "@citegeist/schema";
import {
  type Completion,
  CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { type EditorState, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";
import { configFacet, refreshEffect } from "./config";
import type { CitationSuggestion, EditorLabels } from "./types";

// Pandoc citations in a text: `[@key]`, `[@key, S. 12]`, `[-@key]` and `@key`. Typing `@` after
// `[`, `;`, a space or at the start of a line offers the library; keys the library does not know
// get a mark. The scanner is the one the export uses, so what the editor marks is what Pandoc sees.

const TRIGGER = /(?<![\p{L}\p{N}_\\@])-?@([\p{L}\p{N}_:.#$%&\-+?<>~/]*)$/u;

function rank(s: CitationSuggestion, q: string): number {
  if (q === "") return 3;
  const key = s.key.toLowerCase();
  const title = s.title.toLowerCase();
  if (key.startsWith(q)) return 0;
  if (title.startsWith(q)) return 1;
  if (key.includes(q)) return 2;
  if (title.includes(q) || (s.detail ?? "").toLowerCase().includes(q)) return 3;
  return -1;
}

/**
 * Filters and orders suggestions for the text typed after `@`: sources of the project before the
 * rest of the library, then prefix of the citekey, prefix of the title, substrings. Hosts use it
 * inside `CitationProvider.suggest`.
 */
export function filterCitations(
  all: readonly CitationSuggestion[],
  query: string,
  limit = 30,
): CitationSuggestion[] {
  const q = query.trim().toLowerCase();
  const group = (s: CitationSuggestion) => (s.group === "project" ? 0 : 1);
  return all
    .map((s, i) => ({ s, i, r: rank(s, q) }))
    .filter((x) => x.r >= 0)
    .sort((a, b) => group(a.s) - group(b.s) || a.r - b.r || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.s);
}

function sectionFor(group: CitationSuggestion["group"], labels: EditorLabels) {
  return group === "project"
    ? { name: labels.sectionProject, rank: 0 }
    : { name: labels.sectionLibrary, rank: 1 };
}

/** The completion source for `@`. Exported so tests and hosts can call it directly. */
export async function citationSource(context: CompletionContext): Promise<CompletionResult | null> {
  const { citations, labels } = context.state.facet(configFacet);
  if (!citations) return null;
  const line = context.state.doc.lineAt(context.pos);
  const match = TRIGGER.exec(line.text.slice(0, context.pos - line.from));
  if (!match) return null;
  const query = match[1] ?? "";
  const found = await citations.suggest(query);
  if (context.aborted) return null;
  const options: Completion[] = found.map((s) => ({
    label: s.key,
    detail: s.title,
    ...(s.detail ? { info: s.detail } : {}),
    type: "item",
    section: sectionFor(s.group, labels),
    apply: s.key,
  }));
  return { from: context.pos - query.length, options, filter: false };
}

/** What the `@` completion offers at `pos` (default: the end of the text). For hosts and tests. */
export function citationCompletions(
  state: EditorState,
  pos: number = state.doc.length,
): Promise<CompletionResult | null> {
  return citationSource(new CompletionContext(state, pos, true));
}

function build(state: EditorState): DecorationSet {
  const { citations, labels } = state.facet(configFacet);
  if (!citations) return Decoration.none;
  const marks = scanCitations(state.doc.toString()).map((ref) => {
    const hit = citations.resolve(ref.key);
    const mark = hit
      ? Decoration.mark({ class: "cm-cite", attributes: { title: hit.title } })
      : Decoration.mark({
          class: "cm-cite cm-cite-unknown",
          attributes: { title: `${labels.citationUnknown}: ${ref.key}` },
        });
    return mark.range(ref.from, ref.to);
  });
  return Decoration.set(marks, true);
}

/** Marks citation keys: known ones in the accent color, unknown ones underlined as a warning. */
export const citationMarks = StateField.define<DecorationSet>({
  create: build,
  update(value, tr) {
    const changed =
      tr.docChanged ||
      tr.effects.some((e) => e.is(refreshEffect)) ||
      tr.startState.facet(configFacet) !== tr.state.facet(configFacet);
    return changed ? build(tr.state) : value;
  },
  provide: (field) => EditorView.decorations.from(field),
});
