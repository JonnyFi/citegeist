import { scanCitations } from "@citegeist/schema";
import {
  type Completion,
  CompletionContext,
  type CompletionResult,
  closeCompletion,
} from "@codemirror/autocomplete";
import { type EditorState, type Range, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";
import { type Cluster, clustersOf } from "./clusters";
import { configFacet, refreshEffect, setFocusEffect } from "./config";
import { editorFocused } from "./live-preview";
import type { CitationInsertKind, CitationSuggestion, EditorLabels } from "./types";
import { CitationChipWidget } from "./widgets";

// Pandoc citations in a text: `[@key]`, `[@key, S. 12]`, `[-@key]` and `@key`. Typing `@` after
// `[`, `;`, a space or at the start of a line offers the library; keys the library does not know
// get a mark. The scanner is the one the export uses, so what the editor marks is what Pandoc sees.
// A bracketed cluster the host can format is drawn as a chip while the cursor is elsewhere.

const TRIGGER = /(?<![\p{L}\p{N}_\\@])-?@([\p{L}\p{N}_:.#$%&\-+?<>~/]*)$/u;
const MENU_QUOTE_LENGTH = 100;

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
 * rest of the library and quote cards last, each group by prefix of the citekey, prefix of the
 * title (the quote for a card), substrings. Hosts use it inside `CitationProvider.suggest`.
 */
export function filterCitations(
  all: readonly CitationSuggestion[],
  query: string,
  limit = 30,
): CitationSuggestion[] {
  const q = query.trim().toLowerCase();
  const group = (s: CitationSuggestion) => (s.kind === "card" ? 2 : s.group === "project" ? 0 : 1);
  return all
    .map((s, i) => ({ s, i, r: rank(s, q) }))
    .filter((x) => x.r >= 0)
    .sort((a, b) => group(a.s) - group(b.s) || a.r - b.r || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.s);
}

function sectionFor(s: CitationSuggestion, labels: EditorLabels) {
  if (s.kind === "card") return { name: labels.sectionCard, rank: 2 };
  return s.group === "project"
    ? { name: labels.sectionProject, rank: 0 }
    : { name: labels.sectionLibrary, rank: 1 };
}

/** The menu options that belong to citations, and what choosing them does. */
const citationOptions = new WeakMap<Completion, { card: string | undefined }>();

/** Whether a completion of the menu is a citation source or a quote card. */
export function isCitationOption(completion: Completion | undefined): boolean {
  return completion !== undefined && citationOptions.has(completion);
}

/** Whether a completion of the menu is a quote card. */
export function isCardOption(completion: Completion | undefined): boolean {
  return completion !== undefined && citationOptions.get(completion)?.card !== undefined;
}

/** The insert kind the key being pressed asks for. Choosing with the mouse leaves it unset. */
let requestedKind: CitationInsertKind | undefined;

/** Runs `accept` (which applies the selected completion synchronously) as the given kind. */
export function withInsertKind<T>(kind: CitationInsertKind, accept: () => T): T {
  requestedKind = kind;
  try {
    return accept();
  } finally {
    requestedKind = undefined;
  }
}

/** The text of the trigger around the cursor: an optional `[`, `-`, the `@` and the query. */
function triggerRange(state: EditorState, queryFrom: number, queryTo: number) {
  let start = queryFrom - 1;
  if (state.sliceDoc(start - 1, start) === "-") start--;
  const dash = state.sliceDoc(start, start + 1) === "-";
  const bracketed = state.sliceDoc(start - 1, start) === "[";
  if (bracketed) start--;
  const closes = bracketed && state.sliceDoc(queryTo, queryTo + 1) === "]";
  return { start, end: closes ? queryTo + 1 : queryTo, bracketed, dash };
}

/** Whether a `]` follows on the line before any `[`, so the cluster is closed already. */
function closedAhead(state: EditorState, pos: number): boolean {
  const rest = state.doc.lineAt(pos).to > pos ? state.sliceDoc(pos, state.doc.lineAt(pos).to) : "";
  const close = rest.indexOf("]");
  const open = rest.indexOf("[");
  return close >= 0 && (open < 0 || close < open);
}

function applySource(key: string) {
  return (view: EditorView, _c: Completion, from: number, to: number) => {
    const { state } = view;
    const t = triggerRange(state, from, to);
    if (!t.bracketed) {
      view.dispatch({
        changes: { from, to, insert: key },
        selection: { anchor: from + key.length },
        userEvent: "input.complete",
      });
      return;
    }
    const head = `[${t.dash ? "-" : ""}@${key}`;
    const swallowed = t.end > to;
    const close = swallowed || !closedAhead(state, to) ? "]" : "";
    const insert = head + close;
    view.dispatch({
      changes: { from: t.start, to: t.end, insert },
      selection: { anchor: t.start + insert.length },
      userEvent: "input.complete",
    });
  };
}

function applyCard(id: string) {
  return (view: EditorView, _c: Completion, from: number, to: number) => {
    const kind = requestedKind ?? "direct";
    const insertCard = view.state.facet(configFacet).citations?.insertCard;
    if (!insertCard) return;
    const t = triggerRange(view.state, from, to);
    // The character after the trigger counts too, so typing on while waiting cancels the insert.
    const probe = view.state.sliceDoc(t.start, t.end + 1);
    closeCompletion(view);
    let pending: Promise<string>;
    try {
      pending = insertCard(id, kind);
    } catch {
      return;
    }
    pending.then(
      (text) => {
        if (typeof text !== "string" || view.state.sliceDoc(t.start, t.end + 1) !== probe) return;
        view.dispatch({
          changes: { from: t.start, to: t.end, insert: text },
          selection: { anchor: t.start + text.length },
          scrollIntoView: true,
          userEvent: "input.complete",
        });
      },
      () => {},
    );
  };
}

function menuQuote(quote: string): string {
  const one = quote.replace(/\s+/g, " ").trim();
  return one.length > MENU_QUOTE_LENGTH ? `${one.slice(0, MENU_QUOTE_LENGTH - 1)}…` : one;
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
  const options: Completion[] = found.map((s) => {
    const card = s.kind === "card" && s.id !== undefined ? s.id : undefined;
    const option: Completion =
      card !== undefined
        ? {
            label: menuQuote(s.title),
            ...(s.detail ? { detail: s.detail } : {}),
            type: "card",
            section: sectionFor(s, labels),
            apply: applyCard(card),
          }
        : {
            label: s.key,
            detail: s.title,
            ...(s.detail ? { info: s.detail } : {}),
            type: "item",
            section: sectionFor(s, labels),
            apply: applySource(s.key),
          };
    citationOptions.set(option, { card });
    return option;
  });
  return { from: context.pos - query.length, options, filter: false };
}

/** What the `@` completion offers at `pos` (default: the end of the text). For hosts and tests. */
export function citationCompletions(
  state: EditorState,
  pos: number = state.doc.length,
): Promise<CompletionResult | null> {
  return citationSource(new CompletionContext(state, pos, true));
}

/** Small hint under the selected quote card in the menu (shown by CSS for `aria-selected`). */
export function cardHint(completion: Completion, state: EditorState): Node | null {
  if (!isCardOption(completion)) return null;
  const hint = document.createElement("span");
  hint.className = "cm-cite-keys-hint";
  hint.textContent = state.facet(configFacet).labels.citationKeysHint;
  return hint;
}

function build(state: EditorState): DecorationSet {
  const { citations, labels } = state.facet(configFacet);
  if (!citations) return Decoration.none;
  const text = state.doc.toString();
  const refs = scanCitations(text);
  const ranges: Range<Decoration>[] = [];

  const sel = state.field(editorFocused, false) === false ? [] : state.selection.ranges;
  const chips: Cluster[] = [];
  for (const cluster of clustersOf(text, refs)) {
    if (!cluster.parsed || !citations.format) continue;
    if (cluster.refs.some((r) => !citations.resolve(r.key))) continue;
    if (sel.some((r) => r.from <= cluster.to && r.to >= cluster.from)) continue;
    const shown = citations.format(cluster.refs);
    if (!shown) continue;
    chips.push(cluster);
    ranges.push(
      Decoration.replace({
        widget: new CitationChipWidget(shown, cluster.from, text.slice(cluster.from, cluster.to)),
      }).range(cluster.from, cluster.to),
    );
  }

  for (const ref of refs) {
    if (chips.some((c) => ref.from >= c.from && ref.to <= c.to)) continue;
    const hit = citations.resolve(ref.key);
    const mark = hit
      ? Decoration.mark({ class: "cm-cite", attributes: { title: hit.title } })
      : Decoration.mark({
          class: "cm-cite cm-cite-unknown",
          attributes: { title: `${labels.citationUnknown}: ${ref.key}` },
        });
    ranges.push(mark.range(ref.from, ref.to));
  }
  return Decoration.set(ranges, true);
}

/**
 * Marks citation keys (known ones in the accent color, unknown ones underlined as a warning) and
 * draws clusters the host can format as chips. One field holds both so they never overlap.
 */
export const citationMarks = StateField.define<DecorationSet>({
  create: build,
  update(value, tr) {
    const changed =
      tr.docChanged ||
      tr.selection !== undefined ||
      tr.effects.some((e) => e.is(refreshEffect) || e.is(setFocusEffect)) ||
      tr.startState.facet(configFacet) !== tr.state.facet(configFacet);
    return changed ? build(tr.state) : value;
  },
  provide: (field) => [
    EditorView.decorations.from(field),
    // A chip is atomic: the cursor steps over it instead of into it.
    EditorView.atomicRanges.of((view) =>
      view.state
        .field(field)
        .update({ filter: (_f, _t, value) => value.spec.widget !== undefined }),
    ),
  ],
});
