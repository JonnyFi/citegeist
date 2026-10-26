import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { Registry } from "@citegeist/ops";
import { afterEach, describe, expect, it } from "vitest";
import { JobQueue } from "../jobs/queue.js";
import { Library } from "../library.js";
import { cleanTmpDirs, itemData, tmpDir } from "../test-helpers.js";
import { bindTextsOperations } from "./ops.js";
import { locatePandoc } from "./pandoc.js";
import { locateTypst } from "./typst.js";

// One real export per format against a fixture library. It runs when Pandoc is installed (PATH,
// Homebrew, or CITEGEIST_TEST_PANDOC pointing at a binary) and is skipped otherwise. The PDF
// export also needs Typst (CITEGEIST_TEST_TYPST). The check of its text uses pdftotext when
// that is installed.

const pinned = process.env.CITEGEIST_TEST_PANDOC;
const located = await locatePandoc({
  localBase: tmpDir("cg-none-"),
  ...(pinned ? { pathEnv: join(pinned, "..") } : {}),
});
const pandoc = located.location;
const typstAt = process.env.CITEGEIST_TEST_TYPST;
const typstLookup = await locateTypst({
  localBase: tmpDir("cg-none-"),
  ...(typstAt ? { pathEnv: join(typstAt, "..") } : {}),
});
const typst = typstLookup.location;
const pdftotext = ["/opt/homebrew/bin/pdftotext", "/usr/local/bin/pdftotext", "/usr/bin/pdftotext"]
  .filter((p) => {
    try {
      execFileSync(p, ["-v"], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  })
  .at(0);

const open: Library[] = [];
afterEach(async () => {
  for (const l of open.splice(0)) await l.close();
  cleanTmpDirs();
});

/** Entries of a ZIP by name, read through the central directory (stored or deflated). */
function readZip(buf: Buffer): Record<string, Buffer> {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(end + 10);
  let at = buf.readUInt32LE(end + 16);
  const out: Record<string, Buffer> = {};
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(at + 10);
    const packed = buf.readUInt32LE(at + 20);
    const nameLength = buf.readUInt16LE(at + 28);
    const extra = buf.readUInt16LE(at + 30);
    const comment = buf.readUInt16LE(at + 32);
    const local = buf.readUInt32LE(at + 42);
    const name = buf.subarray(at + 46, at + 46 + nameLength).toString("utf8");
    const dataAt = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(dataAt, dataAt + packed);
    out[name] = method === 8 ? inflateRawSync(data) : data;
    at += 46 + nameLength + extra + comment;
  }
  return out;
}

async function library() {
  const lib = await Library.init(tmpDir("cg-real-"), {
    name: "Real",
    localBase: tmpDir("cg-local-"),
    watch: false,
  });
  open.push(lib);
  lib.createProject("human", { slug: "phd", title: "PhD", brief: "Brief" });
  lib.writeItem(
    itemData("luhmann1984soziale", {
      title: "Soziale Systeme",
      publisher: "Suhrkamp",
      "publisher-place": "Frankfurt am Main",
    }),
  );
  lib.writeItem(
    itemData("gillespie2018custodians", {
      title: "Custodians of the Internet",
      author: [{ family: "Gillespie", given: "Tarleton" }],
      issued: 2018,
      publisher: "Yale University Press",
    }),
  );
  lib.writeItem(itemData("unused2000book", { title: "Never cited" }));
  const registry = new Registry();
  bindTextsOperations(registry, lib, {
    localBase: tmpDir("cg-base-"),
    queue: new JobQueue({ dbPath: join(tmpDir("cg-jobs-"), "state.sqlite") }),
    locate: async () => (pandoc ? { location: pandoc, rejected: [] } : { rejected: [] }),
    locateTypst: async () => typstLookup,
    pathEnv: "",
    exists: () => false,
  });
  const call = <T>(name: string, input: unknown) =>
    registry.call(name, { actor: "human" }, input) as Promise<T>;
  await call("texts.create", {
    project: "phd",
    title: "Kapitel 2",
    slug: "kapitel-2",
    body: [
      "# Kommunikation",
      "",
      "Soziale Systeme bestehen aus Kommunikation [@luhmann1984soziale, S. 12; vgl. @gillespie2018custodians].",
      "Außerdem @gillespie2018custodians.",
    ].join("\n"),
  });
  return { lib, call };
}

const text = (xml: string) =>
  xml
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

describe.skipIf(!pandoc)("a real Pandoc export", () => {
  it("formats the citations and the bibliography of a Word file in the project's style", async () => {
    const { lib, call } = await library();
    const out = await call<{ path: string; unknown: string[]; pandoc: string }>("texts.export", {
      project: "phd",
      text: "kapitel-2",
      format: "docx",
    });
    expect(out.unknown).toEqual([]);
    const docx = readZip(readFileSync(join(lib.root, out.path)));
    const body = text(docx["word/document.xml"]?.toString("utf8") ?? "");
    expect(body).toContain("Kapitel 2");
    expect(body).toContain("(Luhmann, 1984, S. 12; vgl. Gillespie, 2018)");
    expect(body).toContain("Gillespie (2018)");
    expect(body).toContain("Literaturverzeichnis");
    expect(body).toContain("Luhmann, N. (1984). Soziale Systeme. Suhrkamp.");
    expect(body).toContain(
      "Gillespie, T. (2018). Custodians of the Internet. Yale University Press.",
    );
    expect(body).not.toContain("Never cited");
    expect(body).not.toContain("@luhmann1984soziale");
  });

  it("follows another style when asked", async () => {
    const { lib, call } = await library();
    const out = await call<{ path: string }>("texts.export", {
      project: "phd",
      text: "kapitel-2",
      format: "docx",
      style: "chicago-author-date",
      lang: "en-US",
    });
    const docx = readZip(readFileSync(join(lib.root, out.path)));
    const body = text(docx["word/document.xml"]?.toString("utf8") ?? "");
    expect(body).toContain("References");
    expect(body).toMatch(/Luhmann 1984/);
  });

  it("writes LaTeX with biblatex commands and the cited entries in references.bib", async () => {
    const { lib, call } = await library();
    const out = await call<{ path: string }>("texts.export", {
      project: "phd",
      text: "kapitel-2",
      format: "latex",
    });
    const zip = readZip(readFileSync(join(lib.root, out.path)));
    expect(Object.keys(zip).sort()).toEqual(["main.tex", "references.bib"]);
    const tex = zip["main.tex"]?.toString("utf8") ?? "";
    expect(tex).toContain("\\usepackage[style=apa,]{biblatex}");
    expect(tex).toContain("\\addbibresource{references.bib}");
    expect(tex).toContain("\\autocites[12]{luhmann1984soziale}[vgl.][]{gillespie2018custodians}");
    expect(tex).toContain("\\textcite{gillespie2018custodians}");
    expect(tex).toContain("\\printbibliography");
    const bib = zip["references.bib"]?.toString("utf8") ?? "";
    expect(bib).toContain("@book{luhmann1984soziale,");
    expect(bib).toContain("@book{gillespie2018custodians,");
    expect(bib).not.toContain("unused2000book");
  });

  it("writes Markdown with the citations resolved", async () => {
    const { lib, call } = await library();
    const out = await call<{ path: string }>("texts.export", {
      project: "phd",
      text: "kapitel-2",
      format: "md",
    });
    const md = readFileSync(join(lib.root, out.path), "utf8");
    expect(md).toContain("(Luhmann, 1984, S. 12; vgl. Gillespie, 2018)");
    expect(md).toContain("# Literaturverzeichnis");
    expect(md).not.toContain("<div");
  });

  it("marks a citekey that is not in the library and still exports", async () => {
    const { lib, call } = await library();
    await call("texts.update", {
      project: "phd",
      text: "kapitel-2",
      body: "Ohne Beleg [@nobody2020none].",
    });
    const out = await call<{ path: string; unknown: string[]; warnings: string[] }>(
      "texts.export",
      { project: "phd", text: "kapitel-2", format: "docx" },
    );
    expect(out.unknown).toEqual(["nobody2020none"]);
    expect(out.warnings.join(" ")).toContain("nobody2020none");
    const docx = readZip(readFileSync(join(lib.root, out.path)));
    expect(text(docx["word/document.xml"]?.toString("utf8") ?? "")).toContain("nobody2020none?");
  });
});

describe.skipIf(!pandoc || !typst)("a real PDF export with Typst", () => {
  it("sets the citations and the bibliography in the style of the project", async () => {
    const { lib, call } = await library();
    const out = await call<{ path: string; engine: string; bytes: number }>("texts.export", {
      project: "phd",
      text: "kapitel-2",
      format: "pdf",
    });
    expect(out.engine).toBe("typst");
    const file = join(lib.root, out.path);
    const pdf = readFileSync(file);
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(out.bytes).toBeGreaterThan(5_000);
    if (!pdftotext) return;
    const copy = join(tmpDir("cg-pdftext-"), "out.pdf");
    writeFileSync(copy, pdf);
    // Typst hyphenates by the language of the text; pdftotext shows the break as a soft hyphen
    const words = execFileSync(pdftotext, ["-layout", copy, "-"], { encoding: "utf8" })
      .replace(/\u00ad\s*/g, "")
      .replace(/\s+/g, " ");
    expect(words).toContain("Kommunikation");
    expect(words).toContain("(Luhmann, 1984, S. 12; vgl. Gillespie, 2018)");
    expect(words).toContain("Gillespie (2018)");
    expect(words).toContain("Literaturverzeichnis");
    expect(words).toContain("Luhmann, N. (1984). Soziale Systeme. Suhrkamp.");
    expect(words).not.toContain("Never cited");
    expect(words).not.toContain("@luhmann1984soziale");
    // APA has entry spacing 0; the entries must still stand on lines of their own
    const boxes = execFileSync(pdftotext, ["-bbox", copy, "-"], { encoding: "utf8" });
    const lastY = (word: string) => {
      const found = [...boxes.matchAll(/yMin="([\d.]+)"[^>]*>([^<]*)</g)].filter(
        (m) => m[2] === word,
      );
      return Number(found.at(-1)?.[1]);
    };
    expect(lastY("Luhmann,") - lastY("Gillespie,")).toBeGreaterThan(12);
  });
});
