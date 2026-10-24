import { describe, expect, it } from "vitest";
import { classifyIdentifier } from "./identifier";

describe("classifyIdentifier", () => {
  it.each([
    ["10.1038/nature12373", "doi"],
    ["doi:10.1038/nature12373", "doi"],
    ["https://doi.org/10.1038/nature12373", "doi"],
    ["1706.03762", "arxiv"],
    ["arXiv:1706.03762v5", "arxiv"],
    ["https://arxiv.org/abs/1706.03762", "arxiv"],
    ["https://arxiv.org/pdf/1706.03762.pdf", "arxiv"],
    ["hep-th/9901001", "arxiv"],
    ["978-3-518-28266-7", "isbn"],
    ["ISBN 3518282662", "isbn"],
    ["PMID: 12345678", "pmid"],
    ["https://example.org/artikel", "url"],
    ["https://example.org/papers/x.pdf", "url"],
    ["@book{luhmann1984, title={Soziale Systeme}}", "bibtex"],
    ["/Users/jonny/Papers/luhmann.pdf", "path"],
    ["~/Papers/luhmann.pdf", "path"],
    ["luhmann.pdf", "path"],
    ["irgendein Text", "unknown"],
    ["", "unknown"],
  ] as const)("reads %s as %s", (input, kind) => {
    expect(classifyIdentifier(input).kind).toBe(kind);
  });

  it("trims the value", () => {
    expect(classifyIdentifier("  10.1038/nature12373 \n").value).toBe("10.1038/nature12373");
  });
});
