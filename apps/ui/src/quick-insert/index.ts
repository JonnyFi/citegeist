export type {
  CitationPayload,
  DeliverResult,
  EditorPayload,
  PaletteTarget,
  QuickInsertBridge,
} from "./bridge";
export { QuickInsertPalette } from "./palette";
export { QuickInsertRoot } from "./root";

/** Hash the palette window loads (`index.html#/quick-insert`). main.tsx renders the palette for it. */
export const QUICK_INSERT_HASH = "#/quick-insert";
