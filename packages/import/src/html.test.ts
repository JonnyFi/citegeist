import { describe, expect, it } from "vitest";
import { htmlToMarkdown, noteTitle } from "./html.js";

describe("htmlToMarkdown", () => {
  it("converts the elements of a Zotero note", () => {
    const html =
      '<div data-schema-version="9"><h1>Reading notes</h1><p>The paper argues that <strong>systems</strong> differ from their <em>environment</em>.</p><ul><li>first</li><li>second with <a href="https://example.org/x">a link</a></li></ul><blockquote><p>A quoted line.</p></blockquote></div>';
    expect(htmlToMarkdown(html)).toBe(
      [
        "# Reading notes",
        "",
        "The paper argues that **systems** differ from their *environment*.",
        "",
        "- first",
        "- second with [a link](https://example.org/x)",
        "",
        "> A quoted line.",
      ].join("\n"),
    );
  });

  it("numbers ordered lists and indents nested lists", () => {
    const md = htmlToMarkdown("<ol><li>one<ul><li>inner</li></ul></li><li>two</li></ol>");
    expect(md).toContain("1. one");
    expect(md).toMatch(/\n {3}- inner/);
    expect(md).toContain("2. two");
  });

  it("keeps the text of citations and highlights", () => {
    const md = htmlToMarkdown(
      '<p>See <span class="citation" data-citation="%7B%22x%22%3A1%7D"><span class="citation-item">Luhmann, 1984</span></span> and <span class="highlight" data-annotation="%7B%7D">&quot;the claim&quot;</span>.</p>',
    );
    expect(md).toBe('See Luhmann, 1984 and "the claim".');
  });

  it("decodes entities and escapes Markdown specials in text", () => {
    expect(htmlToMarkdown("<p>Tom &amp; Jerry &lt;3 snake_case *star* &#8211; &auml;</p>")).toBe(
      "Tom & Jerry <3 snake\\_case \\*star\\* – ä",
    );
  });

  it("renders code, pre, rules, breaks and tables", () => {
    const md = htmlToMarkdown(
      "<p>Use <code>x &lt; y</code></p><pre>line1\nline2</pre><hr><p>a<br>b</p><table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>",
    );
    expect(md).toContain("Use `x < y`");
    expect(md).toContain("```\nline1\nline2\n```");
    expect(md).toContain("---");
    expect(md).toContain("a  \nb");
    expect(md).toContain("| A | B |\n| --- | --- |\n| 1 | 2 |");
  });

  it("drops scripts and images that are not on the web, and survives broken markup", () => {
    expect(
      htmlToMarkdown('<p>a<script>alert(1)</script><img src="data:image/png;base64,xx">b'),
    ).toBe("ab");
    expect(htmlToMarkdown("<p>unclosed <b>bold <i>both</p> after")).toContain("**bold *both***");
    expect(htmlToMarkdown("")).toBe("");
  });
});

describe("noteTitle", () => {
  it("takes the first line as plain text", () => {
    expect(noteTitle("# Reading **notes**\n\nbody")).toBe("Reading notes");
    expect(noteTitle("- [link](https://x.org) first\nsecond")).toBe("link first");
    expect(noteTitle("\n\n")).toBeUndefined();
  });

  it("shortens long lines", () => {
    const t = noteTitle("word ".repeat(40)) ?? "";
    expect(t.length).toBeLessThanOrEqual(80);
    expect(t.endsWith("…")).toBe(true);
  });
});
