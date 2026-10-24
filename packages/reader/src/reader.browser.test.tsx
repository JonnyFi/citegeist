import type { TextAnchorRecord } from "@citegeist/anchoring";
import { describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import type { ReaderHighlight, SelectionAnchors } from "./index.js";
import { PdfView, ReaderToolbar, ReflowView, sanitizeHtml } from "./index.js";
import {
  FIXTURE_SOURCE,
  fixtureBlocks,
  fixtureHtml,
  fixturePdf,
  fixtureStream,
} from "./testing/fixture.js";

const pdfData = fixturePdf();
const stream = fixtureStream();

function Frame({ children }: { children: React.ReactNode }) {
  return <div style={{ height: 900, width: 900 }}>{children}</div>;
}

// pdf.js rendering on CI runners takes several seconds; the default poll timeout is 1 s.
const POLL = { timeout: 20_000, interval: 100 };

async function textLayerReady(pageIndex = 0) {
  await expect
    .poll(() => document.querySelector(`.cg-page[data-page="${pageIndex}"]`), POLL)
    .not.toBeNull();
  document.querySelector(`.cg-page[data-page="${pageIndex}"]`)?.scrollIntoView();
  await expect
    .poll(
      () =>
        document.querySelectorAll(`.cg-page[data-page="${pageIndex}"] .textLayer span[data-item]`)
          .length,
      POLL,
    )
    .toBeGreaterThanOrEqual(1);
}

/** Select text in the pdf.js text layer of one page, from the start of `from` to the end of `to`. */
function selectInPdf(pageIndex: number, from: string, to: string) {
  const spans = [
    ...document.querySelectorAll<HTMLElement>(
      `.cg-page[data-page="${pageIndex}"] .textLayer span[data-item]`,
    ),
  ];
  const a = spans.find((s) => s.textContent?.includes(from));
  const b = spans.find((s) => s.textContent?.includes(to));
  if (!a?.firstChild || !b?.firstChild) throw new Error(`text not found: ${from} / ${to}`);
  const so = (a.textContent ?? "").indexOf(from);
  const eo = (b.textContent ?? "").indexOf(to) + to.length;
  window.getSelection()?.setBaseAndExtent(a.firstChild, so, b.firstChild, eo);
}

/** Select text inside the reflow document. */
function selectInReflow(blockId: string, from: string, to: string) {
  const el = document.getElementById(blockId);
  const node = el?.firstChild;
  if (!node) throw new Error(`block ${blockId} not found`);
  const text = node.textContent ?? "";
  const so = text.indexOf(from);
  const eo = text.indexOf(to) + to.length;
  window.getSelection()?.setBaseAndExtent(node, so, node, eo);
}

async function pressPopover() {
  await expect.element(page.getByTestId("selection-action")).toBeVisible();
  await page.getByTestId("selection-action").click();
}

function created(fn: ReturnType<typeof vi.fn>): SelectionAnchors {
  expect(fn).toHaveBeenCalledOnce();
  return fn.mock.calls[0]?.[0] as SelectionAnchors;
}

function box(id: string) {
  const els = [...document.querySelectorAll<HTMLElement>(`[data-highlight-id="${id}"]`)];
  return els.map((e) => e.getBoundingClientRect());
}

describe("PdfView", () => {
  it("renders every page with a text layer", async () => {
    await render(
      <Frame>
        <PdfView data={pdfData} source={FIXTURE_SOURCE} />
      </Frame>,
    );
    await textLayerReady();
    expect(document.querySelectorAll(".cg-page")).toHaveLength(3);
    expect(document.querySelector(".textLayer")?.textContent).toContain("Systems and Observation");
  });

  it("emits pdf anchor, text anchor and quote for a selection on one line", async () => {
    const onCreate = vi.fn();
    await render(
      <Frame>
        <PdfView data={pdfData} source={FIXTURE_SOURCE} stream={stream} onCreateAnchor={onCreate} />
      </Frame>,
    );
    await textLayerReady();
    selectInPdf(0, "Closure does not mean isolation", "Closure does not mean isolation");
    await pressPopover();
    const a = created(onCreate);
    expect(a.quote).toBe("Closure does not mean isolation");
    expect(a.textAnchor).toMatchObject({
      block: "bpara0002",
      exact: "Closure does not mean isolation",
    });
    expect(a.textAnchor.prefix).toContain("operative closure.");
    expect(a.textAnchor.suffix.startsWith(", since the system")).toBe(true);
    expect(a.location.first).toEqual({ page: 0, label: "9" });
    expect(a.pdfAnchor?.page).toBe(0);
    expect(a.pdfAnchor?.file).toBe(FIXTURE_SOURCE);
    expect(a.pdfAnchor?.quads).toHaveLength(1);
    // the line sits at baseline y = 599 starting at x = 72 in PDF user space
    const [x1, y1, x2, y2] = a.pdfAnchor?.quads[0] ?? [0, 0, 0, 0];
    expect(x1).toBeGreaterThan(68);
    expect(x1).toBeLessThan(76);
    expect(x2).toBeGreaterThan(x1 + 60);
    expect(y1).toBeLessThan(599);
    expect(y2).toBeGreaterThan(599);
  });

  it("emits one rect per line and joins the hyphenated word for a multi-line selection", async () => {
    const onCreate = vi.fn();
    await render(
      <Frame>
        <PdfView data={pdfData} source={FIXTURE_SOURCE} stream={stream} onCreateAnchor={onCreate} />
      </Frame>,
    );
    await textLayerReady();
    selectInPdf(0, "presupposes a distinc", "has a marked side");
    await pressPopover();
    const a = created(onCreate);
    expect(a.quote).toBe("presupposes a distinction, and every distinction has a marked side");
    expect(a.pdfAnchor?.quads).toHaveLength(2);
    expect(a.textAnchor.block).toBe("bpara0001");
    expect(a.location.blocks[0]?.id).toBe("bpara0001");
  });

  it("snaps a selection that ends or starts in the middle of a word", async () => {
    const onCreate = vi.fn();
    await render(
      <Frame>
        <PdfView data={pdfData} source={FIXTURE_SOURCE} stream={stream} onCreateAnchor={onCreate} />
      </Frame>,
    );
    await textLayerReady();
    selectInPdf(0, "losure does not mean isola", "losure does not mean isola");
    // the live selection grows to the whole words, so the reader sees what the card will quote
    await expect
      .poll(() => window.getSelection()?.toString(), POLL)
      .toBe("Closure does not mean isolation");
    await pressPopover();
    const a = created(onCreate);
    expect(a.quote).toBe("Closure does not mean isolation");
    expect(a.textAnchor.exact).toBe("Closure does not mean isolation");
    expect(a.textAnchor.prefix).toContain("operative closure.");
    expect(a.textAnchor.suffix.startsWith(", since the system")).toBe(true);
    expect(a.pdfAnchor?.quads).toHaveLength(1);
  });

  it("snaps a selection whose end cuts the first word of the next line", async () => {
    const onCreate = vi.fn();
    await render(
      <Frame>
        <PdfView data={pdfData} source={FIXTURE_SOURCE} stream={stream} onCreateAnchor={onCreate} />
      </Frame>,
    );
    await textLayerReady();
    selectInPdf(0, "presupposes a distinc", "has a marked si");
    await pressPopover();
    const a = created(onCreate);
    expect(a.quote).toBe("presupposes a distinction, and every distinction has a marked side");
    expect(a.pdfAnchor?.quads).toHaveLength(2);
  });

  it("makes the text anchor from the PDF text when no document stream is given", async () => {
    const onCreate = vi.fn();
    await render(
      <Frame>
        <PdfView data={pdfData} source={FIXTURE_SOURCE} onCreateAnchor={onCreate} />
      </Frame>,
    );
    await textLayerReady();
    await textLayerReady(1);
    selectInPdf(1, "Meaning is the medium", "selves");
    await pressPopover();
    const a = created(onCreate);
    expect(a.textAnchor.block).toBeUndefined();
    expect(a.quote).toBe(
      "Meaning is the medium in which psychic and social systems reproduce themselves",
    );
    expect(a.location.first).toEqual({ page: 1, label: "10" });
  });

  it("renders a stored highlight from its quads", async () => {
    const hl: ReaderHighlight = {
      id: "h-quads",
      anchor: { pdf: { page: 0, quads: [[72, 595, 200, 609]], file: FIXTURE_SOURCE } },
    };
    const onResolved = vi.fn();
    await render(
      <Frame>
        <PdfView
          data={pdfData}
          source={FIXTURE_SOURCE}
          highlights={[hl]}
          onHighlightsResolved={onResolved}
        />
      </Frame>,
    );
    await expect.poll(() => box("h-quads").length, POLL).toBe(1);
    const pageBox = document.querySelector(".cg-page")?.getBoundingClientRect();
    const r = box("h-quads")[0];
    expect(r?.left).toBeCloseTo((pageBox?.left ?? 0) + 72 * 1.25, 0);
    expect(r?.top).toBeCloseTo((pageBox?.top ?? 0) + (792 - 609) * 1.25, 0);
    expect(r?.width).toBeCloseTo(128 * 1.25, 0);
    await expect.poll(() => onResolved.mock.lastCall?.[0], POLL).toEqual({ "h-quads": "pdf" });
  });

  it("re-finds a highlight without pdf anchor through the text anchor", async () => {
    const text: TextAnchorRecord = {
      block: "bpara0004",
      exact: "emerges only in the act of communication itself.",
      prefix: "is not given in advance but ",
      suffix: "",
    };
    const onResolved = vi.fn();
    await render(
      <Frame>
        <PdfView
          data={pdfData}
          source={FIXTURE_SOURCE}
          highlights={[{ id: "h-text", anchor: { text } }]}
          onHighlightsResolved={onResolved}
        />
      </Frame>,
    );
    await expect.poll(() => box("h-text").length, POLL).toBe(1);
    const pageBox = document.querySelectorAll(".cg-page")[1]?.getBoundingClientRect();
    const r = box("h-text")[0];
    expect(r?.top).toBeGreaterThan(pageBox?.top ?? 0);
    expect(r?.bottom).toBeLessThan(pageBox?.bottom ?? 0);
    await expect.poll(() => onResolved.mock.lastCall?.[0], POLL).toEqual({ "h-text": "text" });
  });

  it("falls back to the text anchor when the PDF anchor belongs to another file", async () => {
    const text: TextAnchorRecord = {
      exact: "Structures are expectations that condense in the course of communication",
      prefix: "",
      suffix: "",
    };
    const hl: ReaderHighlight = {
      id: "h-other",
      anchor: { pdf: { page: 0, quads: [[0, 0, 10, 10]], file: "aaaaaaaaaaaa" }, text },
    };
    await render(
      <Frame>
        <PdfView data={pdfData} source={FIXTURE_SOURCE} highlights={[hl]} />
      </Frame>,
    );
    await expect.poll(() => box("h-other").length, POLL).toBeGreaterThan(0);
    const pageBox = document.querySelectorAll(".cg-page")[2]?.getBoundingClientRect();
    expect(box("h-other")[0]?.top).toBeGreaterThan(pageBox?.top ?? 0);
  });

  it("reports an unknown anchor as orphaned and draws nothing", async () => {
    const onResolved = vi.fn();
    const hl: ReaderHighlight = {
      id: "h-gone",
      anchor: {
        text: {
          exact: "this sentence never appeared in the document at all",
          prefix: "",
          suffix: "",
        },
      },
    };
    await render(
      <Frame>
        <PdfView
          data={pdfData}
          source={FIXTURE_SOURCE}
          highlights={[hl]}
          onHighlightsResolved={onResolved}
        />
      </Frame>,
    );
    await expect.poll(() => onResolved.mock.lastCall?.[0], POLL).toEqual({ "h-gone": "orphaned" });
    expect(box("h-gone")).toHaveLength(0);
  });

  it("reports clicks on a highlight", async () => {
    const onClick = vi.fn();
    const hl: ReaderHighlight = {
      id: "h-click",
      anchor: { pdf: { page: 0, quads: [[72, 595, 200, 609]], file: FIXTURE_SOURCE } },
    };
    await render(
      <Frame>
        <PdfView
          data={pdfData}
          source={FIXTURE_SOURCE}
          highlights={[hl]}
          onHighlightClick={onClick}
        />
      </Frame>,
    );
    await expect.poll(() => box("h-click").length, POLL).toBe(1);
    const r = box("h-click")[0];
    if (!r) throw new Error("no box");
    document
      .querySelector(".cg-page")
      ?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, clientX: r.left + 5, clientY: r.top + 5 }),
      );
    expect(onClick).toHaveBeenCalledWith("h-click");
  });
});

describe("ReflowView", () => {
  const html = fixtureHtml();

  it("renders doc.html with block ids and page attributes", async () => {
    await render(
      <Frame>
        <ReflowView html={html} />
      </Frame>,
    );
    await expect.poll(() => document.getElementById("bpara0003"), POLL).not.toBeNull();
    expect(document.getElementById("bpara0003")?.closest("section")?.dataset).toMatchObject({
      page: "1",
      label: "10",
    });
  });

  it("emits a text anchor with block id and printed page for a selection", async () => {
    const onCreate = vi.fn();
    await render(
      <Frame>
        <ReflowView html={html} stream={stream} onCreateAnchor={onCreate} />
      </Frame>,
    );
    await expect.poll(() => document.getElementById("bpara0003"), POLL).not.toBeNull();
    selectInReflow("bpara0003", "Every actualisation of meaning", "further possibilities");
    await pressPopover();
    const a = created(onCreate);
    expect(a.quote).toBe("Every actualisation of meaning points to further possibilities");
    expect(a.textAnchor.block).toBe("bpara0003");
    expect(a.textAnchor.start).toBe(stream.text.indexOf(a.quote));
    expect(a.pdfAnchor).toBeUndefined();
    expect(a.location.first).toEqual({ page: 1, label: "10" });
  });

  it("snaps a selection that ends or starts in the middle of a word", async () => {
    const onCreate = vi.fn();
    await render(
      <Frame>
        <ReflowView html={html} stream={stream} onCreateAnchor={onCreate} />
      </Frame>,
    );
    await expect.poll(() => document.getElementById("bpara0003"), POLL).not.toBeNull();
    selectInReflow("bpara0003", "very actualisation of meaning", "further possibil");
    await expect
      .poll(() => window.getSelection()?.toString(), POLL)
      .toBe("Every actualisation of meaning points to further possibilities");
    await pressPopover();
    const a = created(onCreate);
    expect(a.quote).toBe("Every actualisation of meaning points to further possibilities");
    expect(a.textAnchor.exact).toBe(a.quote);
    expect(a.textAnchor.start).toBe(stream.text.indexOf(a.quote));
  });

  it("leaves a selection on word boundaries as it is", async () => {
    const onCreate = vi.fn();
    await render(
      <Frame>
        <ReflowView html={html} stream={stream} onCreateAnchor={onCreate} />
      </Frame>,
    );
    await expect.poll(() => document.getElementById("bpara0003"), POLL).not.toBeNull();
    selectInReflow("bpara0003", "actualisation of meaning", "of meaning");
    await pressPopover();
    expect(created(onCreate).quote).toBe("actualisation of meaning");
  });

  it("renders a stored highlight over the right block", async () => {
    const hl: ReaderHighlight = {
      id: "h-reflow",
      anchor: {
        text: {
          block: "bpara0003",
          exact: "Every actualisation of meaning points to further possibilities",
          prefix: "reproduce themselves. ",
          suffix: " that remain accessible",
        },
      },
    };
    const onResolved = vi.fn();
    await render(
      <Frame>
        <ReflowView html={html} highlights={[hl]} onHighlightsResolved={onResolved} />
      </Frame>,
    );
    await expect.poll(() => box("h-reflow").length, POLL).toBeGreaterThan(0);
    const blockRect = document.getElementById("bpara0003")?.getBoundingClientRect();
    for (const r of box("h-reflow")) {
      expect(r.top).toBeGreaterThanOrEqual((blockRect?.top ?? 0) - 1);
      expect(r.bottom).toBeLessThanOrEqual((blockRect?.bottom ?? 0) + 1);
    }
    await expect.poll(() => onResolved.mock.lastCall?.[0], POLL).toEqual({ "h-reflow": "text" });
  });

  it("re-finds a highlight after re-conversion changed a word", async () => {
    const hl: ReaderHighlight = {
      id: "h-fuzzy",
      anchor: {
        text: {
          block: "bpara0002",
          exact: "A system differentiates itself from its environment by operative closure.",
          prefix: "",
          suffix: " Closure does not mean isolation",
        },
      },
    };
    const changed = html.replace("differentiates itself", "differentiated itself");
    await render(
      <Frame>
        <ReflowView html={changed} highlights={[hl]} />
      </Frame>,
    );
    await expect.poll(() => box("h-fuzzy").length, POLL).toBeGreaterThan(0);
  });

  it("removes active content from doc.html", () => {
    const dirty =
      '<p id="bpara0009" onclick="x()">ok<script>alert(1)</script><a href="javascript:alert(1)">l</a></p>';
    const clean = sanitizeHtml(dirty);
    expect(clean).not.toContain("script");
    expect(clean).not.toContain("onclick");
    expect(clean).not.toContain("javascript:");
    expect(clean).toContain("bpara0009");
  });

  it("removes the bypasses of a plain deny list", () => {
    const cases: Array<[string, RegExp]> = [
      // SVG animation rewrites the href of the link that holds it (needs one click)
      [
        '<svg><a href="#"><animate attributeName="href" values="javascript:alert(1)"/></a></svg>',
        /animate|javascript/i,
      ],
      [
        '<svg><a href="#"><set attributeName="href" to="javascript:alert(1)"/></a></svg>',
        /<set|javascript/i,
      ],
      // whitespace and control characters inside the scheme
      ['<a href="java&#x09;script:alert(1)">x</a>', /javascript|java\s*script/i],
      ['<a href="&#x01;javascript:alert(1)">x</a>', /javascript/i],
      ['<a href="vbscript:msgbox(1)">x</a>', /vbscript/i],
      // HTML and SVG in a data: URL, and other schemes
      ['<a href="data:text/html;base64,PHNjcmlwdD4=">x</a>', /data:/i],
      ['<img src="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=">', /data:/i],
      ['<a href="file:///etc/passwd">x</a>', /file:/i],
      ['<img srcset="javascript:alert(1) 1x, https://example.org/a.png 2x">', /javascript/i],
      // frames, embedded HTML and templates
      [
        '<svg><foreignObject><iframe src="https://example.org"></iframe></foreignObject></svg>',
        /foreignobject|iframe/i,
      ],
      ['<svg><use href="data:image/svg+xml,x#a"/></svg>', /<use/i],
      [
        '<noscript><p title="</noscript><img src=x onerror=alert(1)>"></p></noscript>',
        /noscript|onerror/i,
      ],
      [
        '<math><annotation-xml encoding="text/html"><img src=x onerror=alert(1)></annotation-xml></math>',
        /annotation-xml|onerror/i,
      ],
      ['<p onmouseover="x()" ONCLICK="y()">x</p>', /onmouseover|onclick/i],
    ];
    for (const [dirty, bad] of cases) expect(sanitizeHtml(dirty), dirty).not.toMatch(bad);
  });

  it("keeps links, images and formulas of a converted paper", () => {
    const clean = sanitizeHtml(
      '<p id="b1">see <a href="https://doi.org/10.1/x">doi</a>, <a href="#fn1">n</a>, <a href="mailto:a@b.c">m</a>' +
        '<img src="data:image/png;base64,AAAA" alt="f"><img src="figures/a.png"></p>' +
        '<math><mi>x</mi><annotation encoding="application/x-tex">x</annotation></math>',
    );
    expect(clean).toContain('href="https://doi.org/10.1/x"');
    expect(clean).toContain('href="#fn1"');
    expect(clean).toContain('href="mailto:a@b.c"');
    expect(clean).toContain('src="data:image/png;base64,AAAA"');
    expect(clean).toContain('src="figures/a.png"');
    expect(clean).toContain("<mi>x</mi>");
    expect(clean).toContain('id="b1"');
  });
});

describe("one stored card in both views", () => {
  it("a card made in the PDF view renders in the PDF view and in the reflow view", async () => {
    const onCreate = vi.fn();
    const first = await render(
      <Frame>
        <PdfView data={pdfData} source={FIXTURE_SOURCE} stream={stream} onCreateAnchor={onCreate} />
      </Frame>,
    );
    await textLayerReady();
    await textLayerReady(1);
    selectInPdf(1, "The unity of the three selections", "information, utterance");
    await pressPopover();
    const a = created(onCreate);
    const hl: ReaderHighlight = {
      id: "card-1",
      anchor: { pdf: a.pdfAnchor, text: a.textAnchor },
    };
    await first.unmount();

    const second = await render(
      <Frame>
        <PdfView data={pdfData} source={FIXTURE_SOURCE} highlights={[hl]} />
      </Frame>,
    );
    await expect.poll(() => box("card-1").length, POLL).toBeGreaterThan(0);
    await second.unmount();
    await render(
      <Frame>
        <ReflowView html={fixtureHtml()} highlights={[hl]} />
      </Frame>,
    );
    await expect.poll(() => box("card-1").length, POLL).toBeGreaterThan(0);
    const blockRect = document.getElementById("bpara0004")?.getBoundingClientRect();
    expect(box("card-1")[0]?.top).toBeGreaterThanOrEqual((blockRect?.top ?? 0) - 1);
    expect(fixtureBlocks().length).toBe(6);
  });
});

describe("ReaderToolbar", () => {
  it("is a controlled language dropdown", async () => {
    const onChange = vi.fn();
    const options = [
      { value: "de", label: "Deutsch" },
      { value: "en", label: "English" },
    ];
    const screen = await render(
      <ReaderToolbar language="de" languages={options} onLanguageChange={onChange}>
        <strong>Source</strong>
      </ReaderToolbar>,
    );
    const select = page.getByTestId("reader-language");
    await expect.element(select).toHaveValue("de");
    await select.selectOptions("en");
    expect(onChange).toHaveBeenCalledWith("en");
    // controlled: the value follows the prop, not the user
    await expect.element(select).toHaveValue("de");
    await screen.rerender(
      <ReaderToolbar language="en" languages={options} onLanguageChange={onChange} />,
    );
    await expect.element(select).toHaveValue("en");
  });

  it("sits in the toolbar slot of the views", async () => {
    await render(
      <Frame>
        <ReflowView
          html={fixtureHtml()}
          toolbar={<ReaderToolbar language="de" languages={[{ value: "de", label: "Deutsch" }]} />}
        />
      </Frame>,
    );
    await expect.element(page.getByTestId("reader-language")).toBeVisible();
  });
});
