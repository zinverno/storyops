# Topic collision

`editorial-kit collision -t "<topic>"` compares a proposed topic against:

1. the author's publications (full text), and
2. the latest research snapshots (titles and tags only).

## Method (deterministic, inspectable)

- stemmed unigrams + bigrams; TF-IDF cosine (smoothed idf)
- BM25 (k1 = 1.2, b = 0.75), normalised by the query's self-score
- keyword Jaccard over top-20 TF-IDF terms; heading overlap
- levels: **high** (cosine ≥ 0.35 or Jaccard ≥ 0.30), **moderate** (≥ 0.15 / ≥ 0.12), **low**

No embeddings, no percentages of "similarity". Raw numbers are shown so the
level can be checked.

## Output

author overlap, recent ecosystem overlap, already-covered concepts, saturated
angles (e.g. "AI / LLM as the headline topic: 4/11 titles"), novel contribution
(narrative gaps and unseen terms), alternative angles (strong narrative gaps).

## Interpretation

- High author overlap → continue the earlier publication; do not repeat it.
- Saturated angle → keep the topic if it is the real story, but lead with the
  concrete engineering substance instead of the generic framing.
- Topical overlap is **not plagiarism** and must never be described as such.
