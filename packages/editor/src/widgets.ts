import { type EditorView, WidgetType } from "@codemirror/view";
import { configFacet, setFocusEffect, toggleFrontmatterEffect } from "./config";
import type { CardEmbed, OpenLinkEvent } from "./types";

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export class BulletWidget extends WidgetType {
  override eq(other: WidgetType): boolean {
    return other instanceof BulletWidget;
  }
  override toDOM(): HTMLElement {
    return el("span", "cm-bullet", "•");
  }
}

export class RuleWidget extends WidgetType {
  override eq(other: WidgetType): boolean {
    return other instanceof RuleWidget;
  }
  override toDOM(): HTMLElement {
    return el("span", "cm-rule");
  }
}

/** Checkbox for `[ ]` and `[x]` task markers. A click rewrites the marker in the document. */
export class CheckboxWidget extends WidgetType {
  constructor(
    readonly checked: boolean,
    readonly pos: number,
  ) {
    super();
  }
  override eq(other: WidgetType): boolean {
    return (
      other instanceof CheckboxWidget && other.checked === this.checked && other.pos === this.pos
    );
  }
  override toDOM(view: EditorView): HTMLElement {
    const box = el("input", "cm-task-checkbox");
    box.type = "checkbox";
    box.checked = this.checked;
    box.addEventListener("mousedown", (e) => {
      e.preventDefault();
      view.dispatch({
        changes: { from: this.pos + 1, to: this.pos + 2, insert: this.checked ? " " : "x" },
      });
    });
    return box;
  }
  override ignoreEvent(): boolean {
    return true;
  }
}

/** Collapsed YAML frontmatter. Clicking it opens the raw text. */
export class FrontmatterWidget extends WidgetType {
  constructor(readonly label: string) {
    super();
  }
  override eq(other: WidgetType): boolean {
    return other instanceof FrontmatterWidget && other.label === this.label;
  }
  override toDOM(view: EditorView): HTMLElement {
    const box = el("div", "cm-frontmatter-fold");
    const button = el("button", "cm-frontmatter-toggle", this.label);
    button.type = "button";
    button.setAttribute("aria-expanded", "false");
    button.addEventListener("mousedown", (e) => {
      e.preventDefault();
      view.dispatch({ effects: toggleFrontmatterEffect.of(true) });
    });
    box.append(button);
    return box;
  }
  override ignoreEvent(): boolean {
    return true;
  }
}

/** Closes an open frontmatter block again. */
export class FrontmatterHeadWidget extends WidgetType {
  constructor(readonly label: string) {
    super();
  }
  override eq(other: WidgetType): boolean {
    return other instanceof FrontmatterHeadWidget && other.label === this.label;
  }
  override toDOM(view: EditorView): HTMLElement {
    const button = el("button", "cm-frontmatter-toggle cm-frontmatter-open", this.label);
    button.type = "button";
    button.setAttribute("aria-expanded", "true");
    button.addEventListener("mousedown", (e) => {
      e.preventDefault();
      view.dispatch({ effects: toggleFrontmatterEffect.of(false) });
    });
    return button;
  }
  override ignoreEvent(): boolean {
    return true;
  }
}

function fill(card: CardEmbed, body: HTMLElement, labels: { page: string }): void {
  body.replaceChildren();
  const quote = el("blockquote", "cm-card-quote", card.quote);
  body.append(quote);
  const meta: string[] = [];
  if (card.kind) meta.push(card.kind);
  if (card.citation) meta.push(card.citation);
  if (card.page) meta.push(labels.page.replace("{page}", card.page));
  if (meta.length > 0) body.append(el("div", "cm-card-meta", meta.join(" · ")));
  if (card.note) body.append(el("div", "cm-card-own", card.note));
}

/** `![[c_...]]` rendered as an inline quote card. Data comes from the provider, maybe later. */
export class CardEmbedWidget extends WidgetType {
  constructor(
    readonly id: string,
    readonly anchor: string | undefined,
  ) {
    super();
  }
  override eq(other: WidgetType): boolean {
    return other instanceof CardEmbedWidget && other.id === this.id && other.anchor === this.anchor;
  }
  override toDOM(view: EditorView): HTMLElement {
    const config = view.state.facet(configFacet);
    const box = el("div", "cm-card-embed");
    box.dataset.cardId = this.id;
    const body = el("div", "cm-card-body", config.labels.cardLoading);
    box.append(body);
    const open = el("button", "cm-card-open", config.labels.openCard);
    open.type = "button";
    open.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const event: OpenLinkEvent = {
        target: this.id,
        embed: true,
        ...(this.anchor ? { anchor: this.anchor } : {}),
      };
      view.state.facet(configFacet).onOpenLink?.(event);
    });
    box.append(open);

    const show = (card: CardEmbed | undefined) => {
      if (!card) {
        box.classList.add("cm-card-missing");
        body.textContent = `${config.labels.cardMissing}: ${this.id}`;
        return;
      }
      fill(card, body, config.labels);
    };
    const result = config.provider?.card?.(this.id);
    if (result instanceof Promise) {
      result.then(show, () => show(undefined));
    } else {
      show(result);
    }
    return box;
  }
  override ignoreEvent(event: Event): boolean {
    return event.target instanceof HTMLElement && event.target.closest(".cm-card-open") !== null;
  }
}

/**
 * A Pandoc citation cluster drawn as its in-text form. A press on it moves the cursor into the
 * cluster, which turns it back into source text.
 */
export class CitationChipWidget extends WidgetType {
  constructor(
    readonly text: string,
    readonly pos: number,
    readonly raw: string = "",
  ) {
    super();
  }
  override eq(other: WidgetType): boolean {
    return (
      other instanceof CitationChipWidget &&
      other.text === this.text &&
      other.pos === this.pos &&
      other.raw === this.raw
    );
  }
  override toDOM(view: EditorView): HTMLElement {
    const chip = el("span", "cm-cite-chip", this.text);
    chip.title = this.raw;
    chip.setAttribute("role", "button");
    chip.setAttribute("aria-label", this.raw);
    chip.addEventListener("mousedown", (event) => {
      event.preventDefault();
      const at = view.posAtDOM(chip);
      view.dispatch({
        selection: { anchor: at + 1 },
        effects: setFocusEffect.of(true),
      });
      view.focus();
    });
    return chip;
  }
  override ignoreEvent(): boolean {
    return true;
  }
}
