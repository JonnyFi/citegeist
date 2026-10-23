export type { TextAnchorRecord } from "./anchor.js";
export { CONTEXT_LEN, createTextAnchor, trimRange, unitAt } from "./anchor.js";
export type { BlockSlice, Location, PageRef } from "./locate.js";
export { locate, locatorFor, pageOfRange } from "./locate.js";
export type { Mapped } from "./mapped.js";
export { concat, fromString, replaceRegex } from "./mapped.js";
export { NORM_ID, normalize, normalizeText } from "./normalize.js";
export type { Anchored, Orphaned, Resolved, ResolveMethod, ResolveOptions } from "./resolve.js";
export {
  findQuote,
  MIN_QUOTE_SCORE,
  MIN_SCORE,
  resolveAnchor,
  snapToWords,
} from "./resolve.js";
export type { PageRange, StreamUnit, TextStream, UnitRange, UnitSpan } from "./stream.js";
export {
  buildBlockStream,
  buildPageStream,
  buildStream,
  rangeFromSource,
  toSource,
} from "./stream.js";
