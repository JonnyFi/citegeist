# Retrieval check for the embedding model

This is the check behind `DEFAULT_MODEL` in `src/models.ts`. It is small on purpose: it
separates a working model from a broken one, and it does not rank two good models with any
statistical weight.

## Data

`fixtures/retrieval.json` (CC0, written for citegeist) holds 60 passages of two to three
sentences, German and English: 36 topics plus 24 near-topic distractors (a second passage on an
adjacent subject). It also holds 20 queries, 10 German and 10 English, each with one expected passage:

- 2 lexical (share words with the passage), 16 paraphrase (no or little shared vocabulary),
  2 cross-lingual (English query, German passage).

## Run it

```
pnpm --filter @citegeist/embed retrieval -- qwen3-embedding-0.6b embeddinggemma-300m
pnpm --filter @citegeist/core retrieval [model-key]
```

The first command embeds the passages and ranks them by cosine similarity (dense only). The second
runs the whole search path in a scratch library with the passages as notes and compares
full-text only, vectors only and hybrid. Both download the model into
`~/Library/Caches/citegeist-embed-eval` (`CITEGEIST_EVAL_DIR` overrides) and never run in CI.

## Results (Apple M4 Pro, CPU, q8 ONNX, 512 dimensions)

| Model | hit@1 | hit@3 | MRR | tokens/s (estimated) | first load | query latency | download |
|---|---|---|---|---|---|---|---|
| EmbeddingGemma-300m | 20/20 | 20/20 | 1.000 | about 3000 | 22 s | 36 ms | 325 MB |
| Qwen3-Embedding-0.6B | 18/20 | 20/20 | 0.950 | about 1500 | 42 s | 27 ms | 603 MB |

Tokens per second are estimated at four characters per token over a 60-passage batch, so they are
good for a ratio, not for planning. Qwen3 missed q08 and q20 at rank 2.

Whole search path with the default model (`pnpm --filter @citegeist/core retrieval`):

| Mode | hit@1 | hit@3 | hit@10 | MRR |
|---|---|---|---|---|
| full-text only | 1/20 | 1/20 | 1/20 | 0.050 |
| vectors only | 20/20 | 20/20 | 20/20 | 1.000 |
| hybrid | 20/20 | 20/20 | 20/20 | 1.000 |

Full-text search requires every query word to occur, so natural-language questions rarely match.
The one query that matches (q11) is also found by the hybrid.

## Decision

`DEFAULT_MODEL` is EmbeddingGemma-300m. It was equal or better on every query, about twice as
fast and half the download. The gap between the models is two queries, which 20 queries cannot
separate, so the decision rests on speed and size more than on accuracy. Qwen3-Embedding-0.6B stays
selectable through `MODELS`.

Costs of the choice: EmbeddingGemma ships under the Gemma Terms of Use, not Apache-2.0. The model
is downloaded by each user from Hugging Face and not redistributed by citegeist. Its context is
2048 tokens against 32K for Qwen3, which is why chunks stay below 512 tokens.

## Similarity floor

With EmbeddingGemma at 512 dimensions, the weakest correct top-1 in the check scored 0.36 and the
six off-topic queries (recipes, football, weather, a nonsense word, quantum computing) topped out
at 0.27. `SemanticSearch` therefore ignores vectors below 0.3 by default (`minSimilarity`). Another
model needs its own floor.

## Falsifiers

- If a check on a real library of the user's papers shows hit@3 below 15 of 20 for the default model, try
  Qwen3 at 1024 dimensions before changing the architecture.
- The earlier plan said to move bulk embedding to MLX in the Python worker when throughput drops
  below roughly 2K tokens/s. On this Mac the default model clears that bar and Qwen3 does not.
