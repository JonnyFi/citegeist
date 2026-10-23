// Styles are injected once instead of imported from CSS files, so the package needs no bundler
// plugin and the pdf.js text layer works the same in Vite, Electron and the test browser.
const CSS = `
.cg-reader { display: flex; flex-direction: column; height: 100%; min-height: 0; position: relative; }
.cg-scroll { flex: 1; overflow: auto; min-height: 0; }
.cg-toolbar { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-bottom: 1px solid rgba(0,0,0,.12); font: 13px system-ui, sans-serif; }
.cg-toolbar-spacer { flex: 1; }
.cg-page { position: relative; margin: 12px auto; background: #fff; box-shadow: 0 1px 4px rgba(0,0,0,.25); }
.cg-page canvas { position: absolute; inset: 0; display: block; }
.textLayer { position: absolute; inset: 0; overflow: clip; opacity: 1; line-height: 1; text-align: initial; text-size-adjust: none; forced-color-adjust: none; transform-origin: 0 0; z-index: 1; }
.textLayer :is(span, br) { color: transparent; position: absolute; white-space: pre; cursor: text; transform-origin: 0 0; }
.textLayer span.markedContent { top: 0; height: 0; }
.textLayer ::selection { background: rgba(0, 100, 255, .3); }
.cg-hl-layer { position: absolute; inset: 0; pointer-events: none; z-index: 0; }
.cg-page .cg-hl-layer { z-index: 2; }
.cg-hl { position: absolute; background: var(--cg-hl-color, rgba(255, 214, 0, .4)); mix-blend-mode: multiply; border-radius: 2px; }
.cg-reflow-body { position: relative; max-width: 46rem; margin: 0 auto; padding: 24px 16px; }
.cg-doc { font: 16px/1.6 Georgia, serif; }
.cg-popover { z-index: 1000; display: flex; gap: 4px; padding: 4px; background: #1f1f1f; border-radius: 6px; box-shadow: 0 2px 8px rgba(0,0,0,.35); }
.cg-popover button { background: transparent; border: 0; color: #fff; font: 13px system-ui, sans-serif; padding: 4px 8px; border-radius: 4px; cursor: pointer; }
.cg-popover button:hover { background: rgba(255,255,255,.18); }
.cg-status { padding: 24px; font: 13px system-ui, sans-serif; color: #666; }
`;

const STYLE_ID = "citegeist-reader-styles";

export function ensureReaderStyles(): void {
  if (typeof document === "undefined" || document.getElementById(STYLE_ID)) return;
  const el = document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = CSS;
  document.head.append(el);
}
