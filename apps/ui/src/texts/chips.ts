import type { ClusterRef } from "@citegeist/editor";
import { citeFormat } from "@citegeist/ops";
import type { Core } from "../lib/core";

/** Renders one citation cluster in a style and locale, or rejects when the core cannot. */
export type RenderCluster = (
  refs: readonly ClusterRef[],
  style: string,
  locale: string,
) => Promise<string>;

/** The renderer of the app: `cite.format`, the same citeproc rendering the export uses. */
export function renderWithCore(core: Core): RenderCluster {
  return async (refs, style, locale) => {
    const out = await core.call(citeFormat, {
      items: refs.map((r) => ({
        citekey: r.key,
        ...(r.locator ? { locator: r.locator } : {}),
        ...(r.label ? { label: r.label } : {}),
        ...(r.prefix ? { prefix: r.prefix } : {}),
      })),
      mode: "citation",
      format: "text",
      style,
      locale,
    });
    return out.text;
  };
}

const keyOf = (refs: readonly ClusterRef[]) => JSON.stringify(refs);

/** Text shown for a cluster the last time, whatever the style was. Survives a change of style. */
export type StaleChips = Map<string, string>;

export interface ChipFormatter {
  /**
   * The in-text form of a cluster in the style and locale of this formatter, or undefined while it
   * is not known yet. A cluster rendered before in another style keeps showing that text until the
   * new one arrives, so a change of style swaps the chips instead of flashing the raw syntax.
   */
  format(refs: readonly ClusterRef[]): string | undefined;
  /** Stops delivering updates. */
  dispose(): void;
}

/**
 * Formats the chips of a text for one style and locale. Unknown clusters are fetched in one batch
 * and `onUpdate` fires once the batch is in, so the editor can redraw.
 */
export function createChipFormatter(options: {
  render: RenderCluster;
  style: string;
  locale: string;
  onUpdate: () => void;
  stale?: StaleChips;
}): ChipFormatter {
  const { render, style, locale, onUpdate } = options;
  const stale = options.stale ?? new Map<string, string>();
  const done = new Map<string, string | null>();
  const requested = new Set<string>();
  const queued = new Map<string, readonly ClusterRef[]>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;

  const flush = () => {
    timer = undefined;
    const batch = [...queued.entries()];
    queued.clear();
    void Promise.all(
      batch.map(async ([key, refs]) => {
        try {
          const text = await render(refs, style, locale);
          done.set(key, text);
          stale.set(key, text);
        } catch {
          // A failed cluster keeps showing the raw syntax and is not asked for again.
          done.set(key, null);
        }
      }),
    ).then(() => {
      if (!disposed) onUpdate();
    });
  };

  return {
    format(refs) {
      // The core cannot render these parts, so the raw syntax stays.
      if (refs.some((r) => r.suffix || r.suppressAuthor)) return undefined;
      const key = keyOf(refs);
      if (done.has(key)) return done.get(key) ?? undefined;
      if (!requested.has(key)) {
        requested.add(key);
        queued.set(key, refs);
        timer ??= setTimeout(flush, 0);
      }
      return stale.get(key);
    },
    dispose() {
      disposed = true;
      if (timer) clearTimeout(timer);
    },
  };
}
