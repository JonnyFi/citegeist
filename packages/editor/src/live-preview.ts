import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { type EditorState, type Extension, type Range, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";
import { configFacet, refreshEffect, setFocusEffect, toggleFrontmatterEffect } from "./config";
import { frontmatterEnd, scanWikiLinks, type WikiMatch } from "./scan";
import {
  BulletWidget,
  CardEmbedWidget,
  CheckboxWidget,
  FrontmatterHeadWidget,
  FrontmatterWidget,
  RuleWidget,
} from "./widgets";

/** Whether the folded frontmatter block is open. */
export const frontmatterOpen = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(toggleFrontmatterEffect)) return e.value;
    return value;
  },
});

/** Whether the editor has focus. Without focus the whole note is shown rendered, cursor or not. */
export { setFocusEffect };
export const editorFocused = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setFocusEffect)) return e.value;
    return value;
  },
});
const trackFocus = EditorView.focusChangeEffect.of((_state, focusing) =>
  setFocusEffect.of(focusing),
);

const HIDE = Decoration.replace({});
const CODE_NODES = new Set(["FencedCode", "CodeBlock", "InlineCode", "CommentBlock", "Comment"]);

/**
 * Builds the live preview: Markdown syntax is hidden and the text styled everywhere the cursor is
 * not. The document itself is never changed, so what is saved is what was loaded plus real edits.
 */
export function buildDecorations(state: EditorState): DecorationSet {
  const doc = state.doc;
  const text = doc.toString();
  const config = state.facet(configFacet);
  const ranges: Range<Decoration>[] = [];
  const sel = state.field(editorFocused, false) === false ? [] : state.selection.ranges;

  const touches = (from: number, to: number) => sel.some((r) => r.from <= to && r.to >= from);
  const lineActive = (pos: number) => {
    const n = doc.lineAt(pos).number;
    return sel.some((r) => doc.lineAt(r.from).number <= n && n <= doc.lineAt(r.to).number);
  };
  const hide = (from: number, to: number) => {
    if (to > from) ranges.push(HIDE.range(from, to));
  };
  const mark = (from: number, to: number, className: string, attrs?: Record<string, string>) => {
    if (to > from)
      ranges.push(
        Decoration.mark({ class: className, ...(attrs ? { attributes: attrs } : {}) }).range(
          from,
          to,
        ),
      );
  };
  const lineClass = (pos: number, className: string) =>
    ranges.push(Decoration.line({ class: className }).range(doc.lineAt(pos).from));

  // Frontmatter ----------------------------------------------------------------------------
  const fmEnd = frontmatterEnd(text);
  if (fmEnd !== null) {
    const open = state.field(frontmatterOpen, false) ?? false;
    const inside = sel.some((r) => r.from < fmEnd && r.to > 0 && !(r.empty && r.from === 0));
    if (open || inside) {
      for (let n = 1; n <= doc.lineAt(fmEnd).number; n++) {
        ranges.push(Decoration.line({ class: "cm-frontmatter" }).range(doc.line(n).from));
      }
      ranges.push(
        Decoration.widget({
          widget: new FrontmatterHeadWidget(config.labels.frontmatter),
          block: true,
          side: -1,
        }).range(0),
      );
    } else {
      ranges.push(
        Decoration.replace({
          widget: new FrontmatterWidget(config.labels.frontmatter),
          block: true,
        }).range(0, fmEnd),
      );
    }
  }
  const start = fmEnd ?? 0;

  // Code ranges are needed first, wiki links inside them stay plain text.
  const tree = ensureSyntaxTree(state, doc.length, 100) ?? syntaxTree(state);
  const code: Array<{ from: number; to: number }> = [];
  tree.iterate({
    from: start,
    enter(node) {
      if (CODE_NODES.has(node.name)) {
        code.push({ from: node.from, to: node.to });
        return false;
      }
      return undefined;
    },
  });

  // Wiki links -------------------------------------------------------------------------------
  const wiki: WikiMatch[] = scanWikiLinks(text.slice(start), code, start).map((m) => ({
    ...m,
    from: m.from + start,
    to: m.to + start,
    innerFrom: m.innerFrom + start,
    innerTo: m.innerTo + start,
    labelFrom: m.labelFrom + start,
  }));
  for (const m of wiki) {
    const resolved = config.provider?.resolve(m.target);
    const kind = resolved?.kind ?? "missing";
    const attrs: Record<string, string> = {
      "data-target": m.target,
      "data-embed": String(m.embed),
      ...(m.anchor ? { "data-anchor": m.anchor } : {}),
      ...(resolved ? { title: resolved.label } : {}),
    };
    const active = touches(m.from, m.to);
    if (active) {
      mark(m.from, m.to, `cm-wikilink cm-wikilink-raw cm-wikilink-${kind}`, attrs);
      continue;
    }
    if (m.embed && m.target.startsWith("c_") && config.provider?.card) {
      ranges.push(
        Decoration.replace({ widget: new CardEmbedWidget(m.target, m.anchor) }).range(m.from, m.to),
      );
      continue;
    }
    hide(m.from, m.labelFrom);
    hide(m.innerTo, m.to);
    mark(m.labelFrom, m.innerTo, `cm-wikilink cm-wikilink-${kind}`, attrs);
  }
  const inWiki = (from: number, to: number) => wiki.some((m) => from >= m.from && to <= m.to);

  // Markdown syntax --------------------------------------------------------------------------
  tree.iterate({
    from: start,
    enter(node) {
      const { name, from, to } = node;
      if (inWiki(from, to)) return false;
      if (CODE_NODES.has(name)) {
        if (name === "FencedCode") {
          const last = doc.lineAt(to).number;
          for (let n = doc.lineAt(from).number; n <= last; n++) {
            ranges.push(Decoration.line({ class: "cm-codeblock" }).range(doc.line(n).from));
          }
        } else if (name === "CodeBlock") {
          const last = doc.lineAt(to).number;
          for (let n = doc.lineAt(from).number; n <= last; n++) {
            ranges.push(Decoration.line({ class: "cm-codeblock" }).range(doc.line(n).from));
          }
        } else if (name === "InlineCode") {
          mark(from, to, "cm-inline-code");
          if (!touches(from, to)) {
            for (let c = node.node.firstChild; c; c = c.nextSibling) {
              if (c.name === "CodeMark") hide(c.from, c.to);
            }
          }
        }
        return false;
      }

      const heading = /^ATXHeading([1-6])$/.exec(name);
      if (heading) {
        lineClass(from, `cm-heading cm-heading-${heading[1]}`);
        if (!lineActive(from)) {
          for (let c = node.node.firstChild; c; c = c.nextSibling) {
            if (c.name === "HeaderMark") {
              const after = text.charAt(c.to) === " " ? c.to + 1 : c.to;
              hide(c.from, after);
            }
          }
        }
        return undefined;
      }
      if (name === "SetextHeading1" || name === "SetextHeading2") {
        lineClass(from, `cm-heading cm-heading-${name.endsWith("1") ? 1 : 2}`);
        return undefined;
      }
      switch (name) {
        case "Emphasis":
        case "StrongEmphasis":
        case "Strikethrough": {
          const cls =
            name === "Emphasis" ? "cm-em" : name === "StrongEmphasis" ? "cm-strong" : "cm-strike";
          mark(from, to, cls);
          if (!touches(from, to)) {
            for (let c = node.node.firstChild; c; c = c.nextSibling) {
              if (c.name === "EmphasisMark" || c.name === "StrikethroughMark") hide(c.from, c.to);
            }
          }
          return undefined;
        }
        case "Link": {
          let url = false;
          for (let c = node.node.firstChild; c; c = c.nextSibling) if (c.name === "URL") url = true;
          if (!url) return false;
          mark(from, to, "cm-link");
          if (!touches(from, to)) {
            for (let c = node.node.firstChild; c; c = c.nextSibling) {
              if (c.name === "LinkMark" || c.name === "URL" || c.name === "LinkTitle")
                hide(c.from, c.to);
            }
          }
          return false;
        }
        case "Autolink":
        case "URL":
          mark(from, to, "cm-url");
          return false;
        case "Blockquote": {
          const last = doc.lineAt(to).number;
          for (let n = doc.lineAt(from).number; n <= last; n++) {
            ranges.push(Decoration.line({ class: "cm-quote" }).range(doc.line(n).from));
          }
          return undefined;
        }
        case "QuoteMark":
          if (!lineActive(from)) hide(from, text.charAt(to) === " " ? to + 1 : to);
          return undefined;
        case "HorizontalRule":
          if (lineActive(from)) lineClass(from, "cm-hr-raw");
          else ranges.push(Decoration.replace({ widget: new RuleWidget() }).range(from, to));
          return false;
        case "ListMark": {
          const list = node.node.parent?.parent?.name;
          if (list === "BulletList" && !lineActive(from)) {
            ranges.push(Decoration.replace({ widget: new BulletWidget() }).range(from, to));
          } else {
            mark(from, to, "cm-list-mark");
          }
          return undefined;
        }
        case "TaskMarker":
          if (!lineActive(from)) {
            const checked = /x/i.test(text.slice(from, to));
            ranges.push(
              Decoration.replace({ widget: new CheckboxWidget(checked, from) }).range(from, to),
            );
          }
          return undefined;
        default:
          return undefined;
      }
    },
  });

  return Decoration.set(ranges, true);
}

export const livePreview: Extension = [
  frontmatterOpen,
  editorFocused,
  trackFocus,
  StateField.define<DecorationSet>({
    create: (state) => buildDecorations(state),
    update(value, tr) {
      const refresh =
        tr.docChanged ||
        tr.selection !== undefined ||
        tr.reconfigured ||
        tr.effects.some(
          (e) => e.is(refreshEffect) || e.is(toggleFrontmatterEffect) || e.is(setFocusEffect),
        ) ||
        syntaxTree(tr.startState) !== syntaxTree(tr.state);
      return refresh ? buildDecorations(tr.state) : value;
    },
    provide: (field) => [
      EditorView.decorations.from(field),
      // Widgets are atomic: the cursor steps over them instead of into them.
      EditorView.atomicRanges.of((view) =>
        view.state
          .field(field)
          .update({ filter: (_f, _t, value) => value.spec.widget !== undefined }),
      ),
    ],
  }),
];
