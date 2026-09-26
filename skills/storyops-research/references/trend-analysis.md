# Trend analysis

## Research history

Every `storyops research platform <id>` or `storyops research import` creates a
research run in `.storyops/storyops.db`. An article seen again is the same
article with a new metric observation; its abstract features are stored once
and rewritten only when their hash changes. Runs are also written as dated
reports in `.storyops/research/<date>/<platform>.{json,md}`.

Stored per article: platform, id, URL, title, author, publication time,
hubs/tags, views, rating, votes, comments, bookmarks, reading time, and
abstract features (heading count/density, intro length, code blocks, images,
diagrams, list/quote density, first-person framing, conflict-first framing,
numbers or question in the headline, before/after, postmortem, tutorial,
architecture framing). Never article text.

## Momentum vs lifetime popularity

- **Lifetime rank**: by total views. Old articles dominate.
- **Heuristic momentum score** (per run only):

```
ageHours = max(1, observedAt − publishedAt); ageDays = max(0.25, ageHours/24)
viewVelocity     = log10(1 + views/ageHours)             w 0.40
ratingVelocity   = sign(r)·log10(1 + |rating|/ageDays)   w 0.25
bookmarkVelocity = log10(1 + bookmarks/ageDays)          w 0.20
commentVelocity  = log10(1 + comments/ageDays)           w 0.15
score = Σ(w·c) / Σ(w of present components)
```

Missing metrics are excluded, never treated as zero. It is one signal, not
quality, not a prediction.

## Saturation

Dimensions (all reported): article share, recent article count, distinct
authors, growth vs the previous window, headline repetition, top-author
concentration, average age, momentum distribution. States come from explicit
rules, first match wins (thresholds in config `analysis.saturation`):

| State | Rule (defaults) |
| --- | --- |
| insufficient-data | fewer than 15 articles in the window |
| highly-saturated | share ≥ 30% |
| crowded | share ≥ 15% |
| emerging | ≥ 2 articles, share < 10%, growth ≥ +50% (or absent before) |
| active | share ≥ 5% or ≥ 4 articles |
| sparse | otherwise |

## Trend direction

Observations (research runs, or publication dates when there are too few
runs) are grouped into `windowDays` buckets (default 7). With ≥ 3 usable
buckets (≥ 5 articles each) and ≥ 4 topic articles, the pooled share of the
later half is compared with the earlier half: rising / declining at ±20%
relative change and ≥ 2 points absolute; otherwise stable. Else
`insufficient-history`. Always report the time range, sample and comparison.

## Patterns

The top third by momentum vs the rest, per abstract feature; reported only
when shares differ by ≥ 20 points. The pattern report adds the history of each
pattern across runs (`more-pronounced`, `less-pronounced`, `similar`).

Good:

> Observed pattern: concrete engineering conflict appears early.
> Evidence: 42% of the high-momentum sample vs 19% of the rest (N=80, weekly).
> Strength: moderate. Possible relevance: may matter when the article has a real
> engineering conflict. Decision: left to the author.

Bad:

> Start with a conflict because popular articles do.
