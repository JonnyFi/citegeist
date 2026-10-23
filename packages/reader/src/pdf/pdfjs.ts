import type * as Pdfjs from "pdfjs-dist";

let cached: Promise<typeof Pdfjs> | undefined;

/**
 * Load pdf.js on first use, so importing the reader never touches the DOM or the worker.
 * The worker URL comes from the bundler (`?url`); apps can set `GlobalWorkerOptions.workerSrc`
 * themselves before the first render to override it.
 */
export function loadPdfjs(): Promise<typeof Pdfjs> {
  cached ??= (async () => {
    const [pdfjs, worker] = await Promise.all([
      import("pdfjs-dist"),
      import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
    ]);
    if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    return pdfjs;
  })();
  return cached;
}
