/**
 * jsdom has no layout. CodeMirror measures text with Range rectangles, so tests stub them with
 * empty results. Import this file first in every test that mounts an editor.
 */
const empty = {
  length: 0,
  item: () => null,
  [Symbol.iterator]: function* () {},
};

const rect = { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, toJSON() {} };

Range.prototype.getClientRects = () => empty as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => rect as DOMRect;
if (!document.elementFromPoint) document.elementFromPoint = () => null;
