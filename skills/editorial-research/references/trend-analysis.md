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

## Pattern transfer

Observations are abstract statements about a sample. Pattern transfer records,
per article, what an observation means for **this** story:

| Observation | Strength | Decision | Our use | Placement |
| --- | --- | --- | --- | --- |
| Higher-momentum engineering articles surface a concrete conflict early. | moderate | apply | Open with the real engineering problem before the project history. | opening + first technical section |
| Higher-momentum articles report measurements more often. | moderate | skip | No measurements exist; numbers are never added to follow a trend. | — |
| AI headlines are saturated in the sample. | notable | skip / adapt | The story has no AI angle; do not add one. | title |

Rules:

- Weak observations start as `skip` (deterministic default); promote one only with a story-specific reason.
- Every decision has a rationale; apply/adapt also need a placement and a concrete consequence.
- Author input and author voice override trends; record `conflictsWithAuthorItems` when they collide.
- Never store titles, passages or openings of researched articles in the artifact (validation rejects
  wording shared with researched titles). Never turn a successful title into a template.
- A trend pattern is never evidence and never a story claim.
- The post-draft audit asks where each applied pattern shaped the article; unused ones are warnings,
  `overridden-by-author` is valid.
- No engagement scores, viral probability, predicted views or headline CTR. Observations describe a sample;
  they promise nothing.
