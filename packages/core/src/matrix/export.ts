import { CitegeistError, type Matrix, type MatrixCell } from "@citegeist/schema";
import { formatCitations } from "../cite-ops.js";
import type { Library } from "../library.js";
import { cellOf } from "./model.js";

export interface MatrixExportOptions {
  format: "markdown" | "csv";
  /** CSL style id. Default: the style of the project. */
  style?: string | undefined;
  locale?: string | undefined;
}

/** Formats citations of one matrix in the project's style. Items that left the library read as their citekey. */
class Citer {
  constructor(
    private readonly lib: Library,
    private readonly matrix: Matrix,
    private readonly opts: MatrixExportOptions,
  ) {}

  private call(
    items: Array<{ citekey: string; locator?: string }>,
    mode: "citation" | "bibliography",
  ) {
    return formatCitations(this.lib, {
      items,
      mode,
      style: this.opts.style,
      locale: this.opts.locale,
      project: this.matrix.project,
      format: "text",
    }).text;
  }

  /** "Luhmann, 1984": the citation of an item without its parentheses. */
  label(citekey: string): string {
    try {
      const text = this.call([{ citekey }], "citation").trim();
      return text.startsWith("(") && text.endsWith(")") ? text.slice(1, -1) : text;
    } catch (err) {
      if (err instanceof CitegeistError) return citekey;
      throw err;
    }
  }

  /** One citation per distinct page of the cell's evidence, or one without page when it has none. */
  cell(citekey: string, cell: MatrixCell): string[] {
    if (cell.evidence.length === 0) return [];
    const pages = [...new Set(cell.evidence.map((e) => e.page))];
    const out: string[] = [];
    for (const page of pages) {
      try {
        out.push(this.call([{ citekey, ...(page ? { locator: page } : {}) }], "citation").trim());
      } catch (err) {
        if (!(err instanceof CitegeistError)) throw err;
        out.push(page ? `(${citekey}, ${page})` : `(${citekey})`);
      }
    }
    return out;
  }

  bibliography(citekeys: string[]): string {
    const known = citekeys.filter((k) => this.label(k) !== k);
    return known.length > 0
      ? this.call(
          known.map((citekey) => ({ citekey })),
          "bibliography",
        )
      : "";
  }
}

function cellText(citer: Citer, citekey: string, cell: MatrixCell): string {
  const text = cell.answer.trim();
  if (text === "") return "";
  return [text, ...citer.cell(citekey, cell)].join(" ");
}

const mdEscape = (s: string): string => s.replace(/\|/g, "\\|").replace(/\s*\r?\n\s*/g, " ");

function toMarkdown(matrix: Matrix, citer: Citer, locale: string): string {
  const header = ["Quelle", ...matrix.columns.map((c) => c.name)];
  const lines = [
    `# ${matrix.title}`,
    "",
    `| ${header.map(mdEscape).join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
  ];
  for (const row of matrix.rows) {
    const cells = matrix.columns.map((c) => cellText(citer, row, cellOf(matrix, row, c.id)));
    lines.push(`| ${[citer.label(row), ...cells].map(mdEscape).join(" | ")} |`);
  }
  const bib = citer.bibliography(matrix.rows);
  if (bib) {
    const heading = locale.toLowerCase().startsWith("de") ? "## Literatur" : "## References";
    lines.push("", heading, "", ...bib.split("\n").map((entry) => `- ${entry}`));
  }
  return `${lines.join("\n")}\n`;
}

const csvField = (s: string): string => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

function toCsv(matrix: Matrix, citer: Citer): string {
  const lines = [["Citekey", "Quelle", ...matrix.columns.map((c) => c.name)]];
  for (const row of matrix.rows) {
    lines.push([
      row,
      citer.label(row),
      ...matrix.columns.map((c) => cellText(citer, row, cellOf(matrix, row, c.id))),
    ]);
  }
  return `${lines.map((l) => l.map(csvField).join(",")).join("\n")}\n`;
}

/** The matrix as a Markdown table or CSV. Cells carry their citations with the page of each quote. */
export function exportMatrix(lib: Library, matrix: Matrix, opts: MatrixExportOptions): string {
  const project = lib.getProject(matrix.project).frontmatter;
  const citer = new Citer(lib, matrix, opts);
  return opts.format === "csv"
    ? toCsv(matrix, citer)
    : toMarkdown(matrix, citer, opts.locale ?? project.locale);
}
