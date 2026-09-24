# Trend analysis

## Snapshot anatomy

`.editorial/research/<YYYY-MM-DD>/<platform>.json` (schema v1) contains:
platform, collection date, status, windows (period/hub/URL), filters, sample
size, sources (with cache age and staleness), failures, articles (metadata +
abstract structural features only), observations, saturated angles,
limitations, and the momentum formula.

## Momentum vs lifetime popularity

- **Lifetime rank**: by total views. Old articles dominate.
- **Heuristic momentum score** (per snapshot only):

```
ageHours = max(1, observedAt − publishedAt); ageDays = max(0.25, ageHours/24)
viewVelocity     = log10(1 + views/ageHours)             w 0.40
ratingVelocity   = sign(r)·log10(1 + |rating|/ageDays)   w 0.25
bookmarkVelocity = log10(1 + bookmarks/ageDays)          w 0.20
commentVelocity  = log10(1 + comments/ageDays)           w 0.15
score = Σ(w·c) / Σ(w of present components)
```

Missing metrics are excluded (listed in `missing`), never treated as zero.
It is one advisory signal, not quality, not a prediction.

## Observations

Articles are split into the top third by momentum vs the rest. For each abstract
feature (conflict framing, question titles, numbers, first person, conflict
within the first 150 words, technical detail within 200 words, code, diagrams,
measurements, before/after or postmortem structure, closing "what next"), an
observation is reported only if shares differ by ≥ 20 percentage points.

Good:

> Observation: In the weekly sample, 3 of 4 higher-momentum articles describe a
> concrete technical problem within the first 150 words, vs 1 of 7 others.
> Sample: 11 articles. Limitations: small sample; top lists are a biased selection.

Bad:

> Always start with conflict because popular articles do.

Recommendations are made later (in the brief), labelled `(advisory)`, and only
when the story genuinely supports them.

## Stale data

The snapshot date and age must accompany every use. If live research failed,
say so and name the fallback snapshot date.
