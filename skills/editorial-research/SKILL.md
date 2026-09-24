---
name: editorial-research
description: Editorial research for technical publications. Collects and indexes an author's publication history, builds the cross-platform continuity map, runs dated public platform research (live for Habr) with transparent heuristic momentum, extracts abstract editorial patterns without copying content, and checks topic collision and saturated angles. Use when you need to know what the author already published, what is currently performing on a platform, or whether a topic is saturated.
license: MIT
compatibility: Needs the editorial-kit CLI (Node.js 20.19+). Live Habr research needs public internet access to habr.com; everything else works offline from cache and fixtures. No paid AI APIs.
metadata:
  version: "0.1.0"
  repository: "https://github.com/zinverno/storyops"
---

# editorial-research

Two independent research dimensions. Never mix them in one conclusion.

| A. Author research | B. Platform research |
| --- | --- |
| What has this author already published and explained? | What kinds of relevant publications perform now? |
| Which promises/open threads exist? | Which editorial patterns repeat? |
| Which story is being continued? | Which angles are saturated? |
| `.editorial/continuity.md` | `.editorial/research/<date>/<platform>.md` |

Platform research is **advisory**. It may inform packaging. It never picks the
topic and never overrides facts, author voice or continuity.

## Tooling

`editorial-kit` CLI (see the editorial-author skill for installation). Run in the editorial workspace.

## A. Author research

```bash
editorial-kit author sync                    # Habr: public profile + article pages
editorial-kit author import <file.md> -p telegram|linkedin|medium|generic-blog
editorial-kit continuity
```

Details and interpretation: [references/author-history.md](references/author-history.md).

## B. Platform research

```bash
editorial-kit research -p habr               # periods/hubs from config
editorial-kit research -p habr --period weekly --hub programming,open_source
editorial-kit research -p habr --refresh     # ignore fresh cache
editorial-kit research -p habr --offline     # cache only
```

- Only Habr has a live adapter. For other platforms the command writes a
  snapshot that says **live research unsupported**; say exactly that.
- Read the snapshot: status (`live`, `cache`, `partial`, `failed`), collection
  date, sample size, windows, filters, limitations.
- Momentum vs lifetime popularity: see [references/trend-analysis.md](references/trend-analysis.md).

## Topic collision

```bash
editorial-kit collision -t "<proposed topic>" [--description "<angle>"]
```

Interpretation: [references/topic-collision.md](references/topic-collision.md).

## Decision rules

- Report observations with sample size and limitations; separate OBSERVATION from RECOMMENDATION.
- Never state "users prefer X" or predict success, virality or engagement lifts.
- Never copy, paraphrase or template another article or author: [references/originality-policy.md](references/originality-policy.md).
- Respect robots.txt, rate limits and access restrictions. Never bypass authentication, paywalls, anti-bot protection or private APIs.
- A 12-hour-old article and a year-old article are not compared by total views.

## Failure behavior

- Live request fails → the tool falls back to the latest snapshot; always state its date, age and the failure reason.
- No snapshot at all → say "no current platform research"; authoring continues with the stable strategy.
- Parser warnings (markup changed) → report them; do not guess missing numbers.

## Outputs

`.editorial/publications/`, `.editorial/publications/index.json`,
`.editorial/continuity.{json,md}`, `.editorial/author-profile.{json,md}`,
`.editorial/research/<date>/<platform>.{json,md}`, collision reports in
`articles/<slug>/research/collision.md`.
