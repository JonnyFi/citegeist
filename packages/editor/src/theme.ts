import { EditorView } from "@codemirror/view";

// Colors come from the host's CSS variables (--ink, --muted, --line, --accent, --sunken) with
// neutral fallbacks, so the editor follows the app's light and dark themes.
const ink = "var(--ink, #26231e)";
const muted = "var(--muted, #706a5f)";
const line = "var(--line, #e4dfd3)";
const accent = "var(--accent, #8a4b2a)";
const accentSoft = "var(--accent-soft, #f1e4da)";
const sunken = "var(--sunken, #f0ede5)";
const surface = "var(--surface, #fffdf9)";
const danger = "var(--danger, #a43a2a)";
const mono = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

export const noteTheme = EditorView.theme({
  "&": { color: ink, backgroundColor: "transparent", fontSize: "16.5px" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: 'ui-serif, "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif',
    lineHeight: "1.7",
  },
  ".cm-content": { caretColor: ink, padding: "0.5rem 0", maxWidth: "68ch" },
  ".cm-cursor": { borderLeftColor: ink },
  ".cm-line": { padding: "0 2px" },
  ".cm-selectionBackground": { backgroundColor: `${accentSoft} !important` },

  ".cm-heading": { fontWeight: "600", lineHeight: "1.3" },
  ".cm-heading-1": { fontSize: "1.7em", paddingTop: "0.6em" },
  ".cm-heading-2": { fontSize: "1.4em", paddingTop: "0.5em" },
  ".cm-heading-3": { fontSize: "1.2em", paddingTop: "0.4em" },
  ".cm-heading-4, .cm-heading-5, .cm-heading-6": { fontSize: "1.05em" },
  ".cm-em": { fontStyle: "italic" },
  ".cm-strong": { fontWeight: "700" },
  ".cm-strike": { textDecoration: "line-through", color: muted },
  ".cm-link, .cm-url": { color: accent, textDecoration: "underline" },
  ".cm-inline-code": {
    fontFamily: mono,
    fontSize: "0.88em",
    backgroundColor: sunken,
    borderRadius: "3px",
    padding: "0 3px",
  },
  ".cm-codeblock": { fontFamily: mono, fontSize: "0.88em", backgroundColor: sunken },
  ".cm-quote": { borderLeft: `3px solid ${line}`, paddingLeft: "0.8em", color: muted },
  ".cm-list-mark": { color: muted },
  ".cm-bullet": { color: muted, display: "inline-block", width: "0.9em" },
  ".cm-rule": { display: "block", borderTop: `1px solid ${line}`, margin: "0.7em 0" },
  ".cm-hr-raw": { color: muted },
  ".cm-task-checkbox": { margin: "0 0.35em 0 0", verticalAlign: "middle", cursor: "pointer" },

  ".cm-wikilink": { borderRadius: "3px", padding: "0 2px" },
  ".cm-wikilink:not(.cm-wikilink-raw)": { cursor: "pointer" },
  ".cm-wikilink-item": { color: accent, fontFamily: mono, fontSize: "0.9em" },
  ".cm-wikilink-note": { color: accent, textDecoration: "underline" },
  ".cm-wikilink-card": { color: accent, fontFamily: mono, fontSize: "0.9em" },
  ".cm-wikilink-missing": { color: danger, textDecoration: "underline dashed" },
  ".cm-cite": { color: accent },
  ".cm-cite-unknown": {
    color: danger,
    textDecoration: "underline wavy",
    textDecorationColor: danger,
  },
  ".cm-wikilink-raw": { backgroundColor: accentSoft, fontFamily: mono, fontSize: "0.9em" },

  ".cm-frontmatter": {
    fontFamily: mono,
    fontSize: "0.85em",
    color: muted,
    backgroundColor: sunken,
  },
  ".cm-frontmatter-toggle": {
    all: "unset",
    cursor: "pointer",
    color: muted,
    fontFamily: "ui-sans-serif, -apple-system, sans-serif",
    fontSize: "12px",
    padding: "2px 8px",
    border: `1px solid ${line}`,
    borderRadius: "4px",
    backgroundColor: sunken,
  },
  ".cm-frontmatter-fold": { padding: "2px 0" },

  ".cm-card-embed": {
    display: "block",
    margin: "0.5em 0",
    padding: "0.6em 0.9em",
    border: `1px solid ${line}`,
    borderLeft: `3px solid ${accent}`,
    borderRadius: "4px",
    backgroundColor: surface,
  },
  ".cm-card-missing": { borderLeftColor: danger, color: muted },
  ".cm-card-quote": { margin: "0", fontStyle: "italic" },
  ".cm-card-meta": {
    marginTop: "0.3em",
    color: muted,
    fontFamily: "ui-sans-serif, -apple-system, sans-serif",
    fontSize: "12px",
  },
  ".cm-card-own": { marginTop: "0.4em" },
  ".cm-card-open": {
    all: "unset",
    cursor: "pointer",
    marginTop: "0.4em",
    color: accent,
    fontFamily: "ui-sans-serif, -apple-system, sans-serif",
    fontSize: "12px",
    textDecoration: "underline",
  },

  ".cm-tooltip": {
    border: `1px solid ${line}`,
    backgroundColor: surface,
    color: ink,
    borderRadius: "6px",
    fontFamily: "ui-sans-serif, -apple-system, sans-serif",
    fontSize: "13px",
  },
  ".cm-tooltip-autocomplete > ul > li": { padding: "3px 8px" },
  ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: accentSoft,
    color: ink,
  },
  ".cm-completionLabel": { fontFamily: mono, fontSize: "12px" },
  ".cm-completionDetail": { marginLeft: "0.6em", color: muted, fontStyle: "normal" },
  ".cm-completionSection": { color: muted, fontSize: "11px", padding: "2px 8px" },
  ".cm-placeholder": { color: muted },
});
