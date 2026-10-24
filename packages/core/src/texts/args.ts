import type { TextExportFormat } from "@citegeist/ops";

/** File names inside the working directory of one Pandoc run. */
export const FILES = {
  input: "main.md",
  csl: "style.csl",
  cslJson: "references.json",
  bib: "references.bib",
} as const;

/**
 * biblatex style for a CSL style id, for the LaTeX export. The two APA styles map to biblatex-apa
 * (the DGPs style is the German APA variant). Anything else falls back to `authoryear`.
 */
export function biblatexStyle(cslStyle: string): string {
  if (cslStyle === "apa" || cslStyle === "deutsche-gesellschaft-fur-psychologie") return "apa";
  if (cslStyle === "chicago-author-date") return "chicago-authordate";
  return "authoryear";
}

/** Heading above the bibliography, by language family. Other languages keep Pandoc's default. */
export function referenceTitle(lang: string): string | undefined {
  const family = lang.toLowerCase().split("-")[0];
  if (family === "de") return "Literaturverzeichnis";
  if (family === "en") return "References";
  return undefined;
}

export interface PandocPlan {
  /** Arguments for the Pandoc run; every file name is relative to the working directory. */
  args: string[];
  /** File Pandoc writes, relative to the working directory. */
  output: string;
  /** Files the run reads besides the text. */
  needs: Array<(typeof FILES)[keyof typeof FILES]>;
}

export interface PlanInput {
  format: TextExportFormat;
  /** BCP 47 language of the text. */
  lang: string;
  /** CSL style id. */
  style: string;
  /** Absolute path of the PDF engine (or its name). Required for pdf. */
  pdfEngine?: string | undefined;
  /** Directory the text lives in, so relative images are found. */
  textDir?: string | undefined;
}

/**
 * Builds the Pandoc arguments of one export. Word, PDF and Markdown format citations with
 * `--citeproc` and the CSL style. LaTeX keeps the citations as biblatex commands, so a
 * supervisor or journal can change the bibliography in Overleaf.
 */
export function buildPandocArgs(input: PlanInput): PandocPlan {
  const base = [FILES.input, "-f", "markdown", "-M", `lang=${input.lang}`];
  const resource = ["--resource-path", input.textDir ? `.:${input.textDir}` : "."];
  const title = referenceTitle(input.lang);
  const citeproc = (link: boolean) => [
    "--citeproc",
    "--bibliography",
    FILES.cslJson,
    "--csl",
    FILES.csl,
    // linked citations jump to the bibliography entry in Word and PDF; in Markdown they are clutter
    ...(link ? ["-M", "link-citations=true"] : []),
    ...(title ? ["-M", `reference-section-title=${title}`] : []),
  ];

  switch (input.format) {
    case "docx":
      return {
        args: [...base, ...resource, "-t", "docx", ...citeproc(true), "-o", "main.docx"],
        output: "main.docx",
        needs: [FILES.cslJson, FILES.csl],
      };
    case "pdf": {
      const typst = /(^|\/)typst$/.test(input.pdfEngine ?? "");
      return {
        args: [
          ...base,
          ...resource,
          "-s",
          "-t",
          "pdf",
          `--pdf-engine=${input.pdfEngine ?? "xelatex"}`,
          ...(typst ? [] : ["-V", "geometry:margin=2.5cm"]),
          ...citeproc(true),
          "-o",
          "main.pdf",
        ],
        output: "main.pdf",
        needs: [FILES.cslJson, FILES.csl],
      };
    }
    case "latex":
      return {
        args: [
          ...base,
          ...resource,
          "-s",
          "-t",
          "latex",
          "--biblatex",
          "--bibliography",
          FILES.bib,
          "-V",
          `biblio-style=${biblatexStyle(input.style)}`,
          "-o",
          "main.tex",
        ],
        output: "main.tex",
        needs: [FILES.bib],
      };
    case "md":
      return {
        args: [
          ...base,
          ...resource,
          "-t",
          "markdown-fenced_divs-native_divs-raw_html-bracketed_spans-header_attributes",
          "--wrap=none",
          ...citeproc(false),
          "-o",
          "main-resolved.md",
        ],
        output: "main-resolved.md",
        needs: [FILES.cslJson, FILES.csl],
      };
  }
}

/** File extension of the exported file. */
export function exportExtension(format: TextExportFormat): string {
  return format === "latex" ? "zip" : format;
}
