---
name: storyops-research
description: Platform and author research for technical authors with the StoryOps CLI. Collects dated platform samples (live for Habr, imported datasets elsewhere) into a persistent history, reports the topic landscape, topic saturation with its dimensions, trend direction over time and observed structural patterns, and maps what the author has already published (coverage map). Use when the author asks what is being published or is crowded on a platform, how a topic is moving, which patterns appear in high-momentum articles, or what they have already written about. It never writes, outlines or titles articles.
license: MIT
compatibility: Needs the storyops CLI (Node.js 20.19+). Live Habr research needs public internet access to habr.com; everything else works offline from the database, cache and fixtures. No paid AI APIs.
metadata:
  version: "0.3.0"
  repository: "https://github.com/zinverno/storyops"
---

# storyops-research

**StoryOps analyses. The human writes.** This skill answers research questions.
It never drafts, outlines, titles or rewrites an article. If asked to write one,
answer: *"I can research the topic, show evidence and review a draft you write."*

Two separate dimensions; never merge them into one verdict:

| A. Platform intelligence | B. Author intelligence |
| --- | --- |
| What is published, what has momentum, what is crowded or sparse, how it moves | What the author already covered, how deeply, and how long ago |
| `storyops trends`, `saturation`, `patterns`, `research history` | `storyops author coverage`, `author overlap` |

## Tooling

`storyops` CLI (`storyops <cmd> --help`). If it is not on PATH: in the storyops
checkout run `npm install && npm run build && npm link`, or call
`node <storyops>/dist/src/cli/index.js`. Run in the workspace (the directory
with `storyops.config.json`; create one with `storyops init`, or migrate an old
`editorial.config.json` workspace with `storyops migrate`). Add `--json` for
machine-readable output.

## A. Platform intelligence

```bash
storyops research platform habr                 # dated sample → database (history accumulates)
storyops research platform habr --period weekly --hub programming
storyops research import dataset.json           # platforms without live research (Medium, LinkedIn, Telegram…)
storyops research history                       # accumulated runs
storyops trends --platform habr --period 30d    # topic landscape: share, authors, state, activity, trend
storyops trends history "AI agents"             # buckets, shares, comparison window
storyops saturation --platform habr --topic "AI agents"
storyops patterns --platform habr               # pattern report (observed, never prescribed)
```

- Only Habr has a live adapter. For other platforms say "live research
  unsupported" and suggest a dataset import; never invent platform data.
- Read the numbers from the aggregated reports in `.storyops/reports/`; do not
  open raw cached pages. Details: [references/trend-analysis.md](references/trend-analysis.md).

## B. Author intelligence

```bash
storyops author sync                            # Habr: public profile + article pages
storyops author import post.md -p telegram      # other platforms: Markdown + frontmatter
storyops author coverage                        # mentioned / covered / deeply covered / revisited / possibly outdated
storyops author overlap "<candidate topic>"     # what is already covered vs what is new
```

Details: [references/author-history.md](references/author-history.md), [references/topic-collision.md](references/topic-collision.md).

## How to report (always)

- Quote the state AND its reasons: *"Saturation: crowded, because 42 articles in
  30d, 31 distinct authors, 18% of the sample, +38% vs the previous window."*
- Always give the time range, sample size and comparison window of a trend.
- Describe, do not judge: *"This topic occupies a large and increasing share of
  the current sample"*, never *"57% means a bad topic"*.
- Patterns: **Observed pattern / Evidence / Strength / Possible relevance**.
  Never "use this". Decision: left to the author.
- Never present popularity as quality; no virality, predicted views, CTR or
  "quality scores". Trend direction implies no cause.

## Decision rules

- Separate OBSERVATION from interpretation; the author makes every decision.
- Never copy, paraphrase or template another article, title, opening or author's
  voice: [references/originality-policy.md](references/originality-policy.md).
- Respect robots.txt, rate limits and access restrictions. Never bypass
  authentication, paywalls, anti-bot protection or private APIs.
- A 12-hour-old article and a year-old article are not compared by total views.

## Failure behavior

- Live request fails → the tool reports the failure and the age of the earlier
  snapshot; nothing new is recorded. Say so.
- `insufficient-data` / `insufficient-history` → report exactly that, with the
  sample sizes; do not guess a state.
- Parser warnings (markup changed) → report them; do not guess missing numbers.
