# Spike S3: highlight anchoring

Status: finished 2026-10-23. Code in `spikes/s3/` (throwaway), raw numbers in `spikes/s3/results/results.json`.

Risk-table row under test (`docs/architecture.md`): cards survive the switch between PDF and text view and re-conversion. Pass criteria: 98 percent of 200 test selections land at the same text in the other view, 95 percent after re-conversion. Fallback if it fails: coarsen anchors to block level.

## Result

| Criterion | Required | Measured |
|---|---|---|
| Same text in the reflow view (200 selections, 3 PDFs) | 98 % | **100 %** (200/200) |
| Same text after simulated re-conversion (whitespace, ligatures, hyphenation, one changed word in 5 % of paragraphs) | 95 % | **100 %** (200/200); five further random seeds: 100, 100, 99.5, 100, 100 % |
| PDF quads map back to the same page (quads to text to reflow position, no page hint) | not set | **99.5 %** (199/200) |

The criteria pass, but the margin comes from a friendly test bench. Section "What the numbers do not show" lists what remains open. The remaining risk sits in S1 (real Docling output), not in the algorithm.

## What was built

Vite + TypeScript, pdfjs-dist 6.4.299, approx-string-match 2.0.1, Playwright 1.64.1 (Chromium). Run it with `npm install`, `npm run data` (downloads the PDFs into the gitignored `data/`), `npx playwright install chromium`, `npm test`. `npm run dev` opens the interactive viewer: select text in the PDF, press "Highlight selection", and the reflow view on the right shows the re-anchored highlight (yellow exact, orange fuzzy); the checkbox applies the re-conversion perturbation.

- `src/anchoring.ts`: pure logic, the candidate for `packages/anchoring`. Origin-mapped text streams, `citegeist-norm-v1`, TextQuote/TextPosition anchor, `reanchor()`.
- `src/pdfmodel.ts`: pdf.js text items, the PDF text stream, the reflow builder (lines, paragraphs by vertical gap, end-of-line dehyphenation), geometry.
- `src/perturb.ts`: re-conversion simulation with seeded randomness.
- `src/main.ts`: viewer, DOM selection capture, evaluation entry points.
- `tests/anchoring.spec.ts`: the automated test.

**Test data.** Three arXiv papers: 1706.03762 (15 pages, two columns, tables), 1810.04805 (16 pages, many tables), 1412.6980 (15 pages, heavy math and algorithm boxes). 200 selections (67, 67, 66), each created by setting a real DOM `Range` on the pdf.js text layer and reading it back through `window.getSelection()`, so the capture path is the one a user triggers. Selections are word-aligned, 4 to 40 words, at least 20 characters, at least 60 percent letters, within one page. Length mix: 11 under 40 characters, 56 between 40 and 99, 133 from 100. The DOM range matched the intended character range in 200 of 200 cases.

**Anchors computed at selection time.**
- PDF anchor: page index plus one rectangle per visual line in PDF user space (y up), converted from `Range.getClientRects()` with `viewport.convertToPdfPoint`.
- Text anchor: W3C TextQuote (`exact`, `prefix` 32, `suffix` 32) plus TextPosition, taken from the normalised document-wide PDF text stream. The TextPosition is used as a verified hint, never alone.

**Ground truth.** Every character of every stream carries the index of the pdf.js text-item character it came from, through normalisation, dehyphenation and every perturbation. A re-anchor counts as correct when the found range overlaps the true range with IoU of at least 0.8. That makes the measurement independent of the matcher's own opinion.

**Re-conversion simulation** (all on the reflow paragraphs, before normalisation):
- `ws`: 4 % of spaces doubled, 3 % non-breaking, 3 % hard line breaks, trailing blanks.
- `lig`: all `ff`, `fi`, `fl`, `ffi`, `ffl` replaced by presentation-form ligatures (pdf.js already folds them, so the interesting direction is an engine that keeps them).
- `hyph`: half of the in-word hyphens deleted, a quarter replaced by a space.
- `word`: one word of at least 4 letters replaced by another word of the document, in 5 % of the paragraphs.
- Extras beyond the brief: `spacing` (1.5 % of word gaps glued, 1 % of words split), `rehyph` (failed dehyphenation, "- " inside 5 % of long words), `wordDense` (1 word in 25 replaced).

## Full results (200 selections each)

"Changed" is the share of selections whose text in the new stream differs from the stored quote, i.e. where the perturbation actually mattered.

| Configuration | Same text | Orphan | Wrong place | Changed |
|---|---|---|---|---|
| Reflow view, no perturbation | 100 % | 0 | 0 | 0 % |
| Perturbed, norm-v1 as written | 100 % | 0 | 0 | 46 % |
| Perturbed, norm-v1 + ligature fold | 100 % | 0 | 0 | 33 % |
| only `ws` | 100 % | 0 | 0 | 0 % |
| only `lig`, norm-v1 / with fold | 100 % / 100 % | 0 | 0 | 27 % / 0 % |
| only `hyph` | 100 % | 0 | 0 | 28 % |
| only `word` | 100 % | 0 | 0 | 2 % |
| extra: spacing jitter | 100 % | 0 | 0 | 41 % |
| extra: failed dehyphenation | 100 % | 0 | 0 | 11 % |
| extra: all of the above combined | 100 % | 0 | 0 | 63 % |
| stress: 1 word in 25 changed | 99.0 % | 1.0 % | 0 | 43 % |
| stress: everything including dense word changes | 99.0 % | 0 | 1.0 % | 76 % |
| ablation: target not normalised | 100 % | 0 | 0 | 91 % |
| ablation: exact match only, no fuzzy | **67.0 %** | 33.0 % | 0 | 33 % |
| ablation: no page window (global fuzzy only) | 100 % | 0 | 0 | 33 % |
| ablation: no position/exact fast path (fuzzy only) | 100 % | 0 | 0 | 33 % |

Which stage resolved the reflow case: 146 by verified position, 54 by exact quote. Even without any re-conversion the position hint fails for 27 percent of the selections, because the reflow stream and the PDF stream differ in line and paragraph joins. After the core perturbation the position hint holds for 1 in 200, exact quote for 133, fuzzy for 66.

Quote length in the two stress runs (1 word in 25 / everything): under 40 characters 10 of 11 and 11 of 11, 40 to 99 characters 98 % and 96 %, from 100 characters 100 % in both.

Cost: the whole test (about 5,600 re-anchorings and 600 stream rebuilds on 40k to 63k character documents) runs in 5.5 seconds in headless Chromium. Fuzzy search is not a performance concern at this size.

## Failure cases

1. **Boundary drift, right place** (stress run, 2 cases). A changed word sits at the edge of the quote, the fuzzy match drops it and the range ends up short: stored `square both sides of the above update rule`, found `s both sides of the above update rule`, truth `outperforms both sides of the above update rule`. The highlight is in the right place but fails IoU 0.8. A word-boundary snap after matching fixes this class.
2. **Reference-list digits** (stress run, `bert-28`). The quote ends in `pages 1499` and contains a changed word and a split word earlier on; the match stopped early at `pages 19`. Digits at the edge are weak evidence. Same boundary class as 1.
3. **Short quotes with a changed word** (`1 in 25` stress, 1 of 11 short quotes orphaned). With under 40 characters one changed word exceeds the error budget of half the quote length. Expected, and the right behaviour is orphan rather than a guess.
4. **Duplicated text** (PDF-to-text direction, `adam-38`). `settings for the tested machine learning problems are` occurs on several pages; searching by the quote text alone, without page hint, picks another page. The anchor flags it as ambiguous. The text anchor resolves it through prefix/suffix and the page window, the PDF anchor never needs it.
5. **Near-duplicate blocks** (negative control, below). Adam's Algorithm 1 and Algorithm 2 differ in a few tokens, so a quote from one deleted block re-anchors to the other with quote score 0.86.

### Negative control

For each selection the paragraphs that contain it were deleted from the new stream; the correct answer is "orphan".

| Thresholds (quote similarity / combined score) | Correctly orphaned | False anchors |
|---|---|---|
| 0.75 / 0.7 (used in the runs above) | 97.0 % | 6 |
| 0.9 / 0.8 | **98.5 %** | 3 |
| 0.6 / 0.5 | 91.5 % | 17 |

Of the 3 survivors at 0.9/0.8, two are exact copies of text that occurs elsewhere in the same paper, which is arguably a correct anchor, and one is a 0.94 match against a near copy. The loose setting produces real mis-anchors (`Geoffrey E Hinton, Alex` to `Geoffrey Hinton,`, `the [MASK] symbol never` to `the [MASK] symbol for`). A quote similarity floor of 0.9 costs nothing on the core perturbation run (100 %), but it was not run on the dense stress configurations.

## What the numbers do not show

- **Both streams come from the same pdf.js items.** The reflow view is a rearrangement of the text the anchor was created from. The perturbations imitate typical differences (whitespace, ligatures, hyphens, edits), but not the large ones of a real second engine: different reading order in columns and floats, dropped headers and footers, math and tables rendered differently, merged or split blocks. The 100 % is an upper bound for a pdf.js-derived conversion and says little about Docling. S1 has to repeat the re-anchoring on real Docling and GROBID output of the fixture PDFs before the 95 percent line is called safe.
- **Selections stay inside one page** and are at least 20 characters long. Cross-page quotes need one rectangle list per page and a quote that spans the break; the text side already works because the stream is document-wide.
- **Horizontal text only.** The rectangle conversion assumes unrotated text; rotated pages and vertical writing are not handled.
- Thresholds were chosen on the same 200 selections they are reported on.
- One seed for the headline run (`7`), five further seeds for the core perturbation as a stability check.

## Recommended algorithm for `packages/anchoring`

**Streams.** Every text stream (PDF text layer, reflow, re-conversion output) is a normalised string plus an origin map: for each output character the offset in the source (item offset, or block id plus offset). Without the origin map there is no way to turn a found range into quads, blocks or page labels.

**Normalisation `citegeist-norm-v1`.** Keep as specified (NFC, soft hyphens removed, end-of-line hyphenation joined, whitespace collapsed) and add one step: fold the presentation-form ligatures U+FB00 to U+FB06 to ASCII. Without the fold, 27 percent of selections need the fuzzy path for ligatures alone; with it the effect is zero. Both sides of every comparison go through the same function.

**Record.** As in the architecture doc: PDF anchor (page index, per-line rectangles in PDF user space, file hash) and text anchor (`exact`, `prefix` 32 characters, `suffix` 32 characters, `position`, normalisation id, block id as hint). The text anchor is created at selection time from the document-wide normalised stream, not derived later from the quads, because quads-to-text alone is ambiguous for repeated phrases (failure case 4).

**Resolve** (in this order, stop at the first hit):
1. Position hint: accept if the text at the stored offsets equals the quote and both contexts. Cheap, but it hits for only about 73 percent of the cases even without re-conversion, so it is a fast path and nothing else.
2. Exact quote anywhere in the stream. With several hits rank them by context score; flag the result ambiguous when a second non-overlapping hit scores within 0.02. A single exact hit of 30 or more characters is accepted without context.
3. Fuzzy search with `approx-string-match`, `maxErrors = min(256, floor(len / 2))`, first in the window of the hinted page plus and minus one page (from the page ranges of the new conversion), then over the whole stream. Keep at most 12 spatially distinct cheapest candidates and score each as in the Hypothesis client: `(50 * quote + 20 * prefix + 20 * suffix + 2 * position) / 92`, where each part is `1 - errors / length` and position is the distance to the hint relative to the stream length.
4. Classification: quote similarity at least 0.9 and score at least 0.8 is **anchored**; quote similarity at least 0.75 and score at least 0.7 is **anchored, unconfirmed** (shown, marked for a glance); everything else is **orphaned** and offered for manual repair. The negative control supports 0.9/0.8 as the automatic line.
5. After a fuzzy hit, snap the range edges to word boundaries and prefer, among equally cheap candidates, the one whose length is closest to the stored quote. This addresses failure cases 1 and 2 and is not yet implemented in the spike.

**Not needed.** Stripping all whitespace before matching, as the Hypothesis client does for PDFs, was not required: the collapse in norm-v1 plus the fuzzy stage absorbed glued and split words (100 % on the spacing run). TextPosition as a standalone fallback is not worth keeping.

**PDF direction.** The PDF anchor is authoritative in the PDF view and needs no matching. Quads to text is a geometry lookup over the page's text items (character centres inside the rectangles) and round-trips at 100 % in text content.

**Expectation and check.** Expect at least 95 percent same-text on real Docling re-conversions of the S1 fixture PDFs with the thresholds above. If S1 measures below 95 percent, or if more than 2 percent of the negative-control cases anchor to a wrong place on real output, the stated fallback applies: coarsen the text anchor to the block (block id plus quote search inside the block and its neighbours).
