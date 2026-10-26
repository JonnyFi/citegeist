# ADR 0026: Retrieval benchmark

Status: accepted. Date: 2026-10-24.

## Context

Search quality needs a fixed yardstick so that changes to chunking, embeddings and reranking can be judged. `fixtures/retrieval/` holds six converted CC-BY documents (four English, two German, 943 sections) and 43 questions in German and English (12 keyword questions, 31 paraphrased ones). Each question names its answering section by a text snippet and not by block ID, so a freshly converted version still matches.

## Decision

- `packages/core/src/semantic/golden.test.ts` runs in `pnpm verify`. It fails when hit@5 falls more than 0.03 or MRR more than 0.05 below the values in `fixtures/retrieval/baseline.json`. Without a model in the local cache (or with `CITEGEIST_SKIP_MODELS=1`, as in CI) only full-text search runs against its own baseline. `pnpm eval:retrieval --golden` prints the numbers and `--record` writes them as the new baseline.
- A section is embedded with its heading path. Title, author and year stay out of the embedded text.
- The reranker is a switch and is off by default. The setting `semantic.rerank` turns it on ("Re-sort results" under "Search by meaning"). It loads in the background and takes effect once ready.

Measured with EmbeddingGemma 300M (512 dimensions, q8) on an M4 Pro, sections as hits, 10 results:

| Setup | hit@5 | MRR | hit@10 |
|---|---|---|---|
| Full text only | 20.9% | 0.192 | 20.9% |
| Hybrid, section carries outline number (e.g. "3.2") | 86.0% | 0.728 | 93.0% |
| Hybrid, heading path | 88.4% | 0.738 | 95.3% |
| Hybrid, path plus author and year | 86.0% | 0.753 | 93.0% |
| Hybrid, path plus title, author and year | 79.1% | 0.710 | 83.7% |
| Hybrid, only title, author and year | 79.1% | 0.710 | 86.0% |

The title in every section pulls the vectors of one document together and cost 4 of 43 questions. Author and year alone change hit@5 by no measurable amount. With 43 questions, a difference of one question (2.3 points) is noise, the 9 points of the title are not. The heading path changes the input of all sections of converted documents. The hash of a chunk contains model ID and input, so the next sync re-embeds exactly these chunks, about 24 chunks per second on an M4 Pro (37 to 41 seconds for the 943 chunks of the test set, around 7 minutes in the background for 10,000 sections). Notes, cards and items keep their hash.

The reranker is a cross-encoder running locally with Transformers.js (pinned commit, q8). Measured with the 15 best candidates and at most 256 tokens per pair:

| Reranker | License | Size (q8) | hit@5 | MRR | Median time per search |
|---|---|---|---|---|---|
| none | | | 88.4% | 0.738 | 39 ms |
| mxbai-rerank-xsmall-v1 | Apache-2.0 | 87 MB | 79.1% | 0.677 | 0.34 s |
| bge-reranker-base | MIT | 279 MB | 86.0% | 0.730 | 0.44 s |
| bge-reranker-v2-m3 | Apache-2.0 | 571 MB | 90.7% | 0.772 | 1.4 s |

mxbai is trained on English and lowers the results most. bge-reranker-v2-m3 is the only one that is not worse. Its gain of one question in hit@5 is noise, and its MRR gain (0.034) costs 1.4 seconds per search against a target of 0.3 seconds. With the 30 best candidates and 512 tokens per pair a search takes 1.1 to 3.4 seconds and hit@5 is 76.7%, 83.7% and 88.4%. EmbeddingGemma 2 (`onnx-community/embeddinggemma-2-ONNX`, Apache-2.0, text model only, q8, 305 MB) reaches hit@5 81.4% and MRR 0.692 at 768 dimensions and 81.4% and 0.674 at 256 dimensions, against 88.4% and 0.738 for the default at 512. The default stays. Both variants are in `MODELS` and run with `pnpm eval:retrieval --golden --model embeddinggemma-2`. The settings do not offer them.

## Consequences

Falsifier: if a reranker with at most 0.3 seconds per search at 15 candidates gains at least 5 points of hit@5 on this test set, it becomes the default.
