---
name: storyops-opportunity
description: Topic discovery for technical authors with the StoryOps CLI. Inspects the author's software repository (history, docs, ADRs, tests) for engineering events, maps them to topics, compares them with the author's publication archive and the platform landscape, and reports topic opportunities as separate dimensions (repository novelty, evidence strength, author overlap, platform activity, saturation, trend, specificity, recency) plus a topic dossier with evidence, risks and questions. Use when the author asks what in their project might be worth writing about, whether a topic was already covered, or how candidate topics compare. It never ranks topics, picks one, or writes the article.
license: MIT
compatibility: Needs the storyops CLI (Node.js 20.19+) and git. Works offline; platform dimensions need earlier `storyops research` runs or imported datasets. No paid AI APIs.
metadata:
  version: "0.3.0"
  repository: "https://github.com/zinverno/storyops"
---

# storyops-opportunity

**StoryOps analyses. The human writes.** This skill finds and explains topic
opportunities; the author chooses and writes. Never produce a draft, outline,
title, introduction or "angle" as final copy. If asked to write the article,
answer: *"I can research the topic, show evidence and review a draft you write."*

## Workflow (human handoff)

```bash
storyops repo inspect --repo <id>                    # events + topic map (read-only)
storyops author sync                                 # or: storyops author import <post.md> -p <platform>
storyops research platform habr                      # optional: platform context
storyops topics discover --repo <id> --platform habr # topics/opportunities.{md,json}
#   → the author selects a topic
storyops topics show <candidate-id>                  # topics/<id>/dossier.{md,json}
#   → the author writes the article independently
#   → then use the storyops-review skill
```

Stay out of the way between the dossier and the review unless the author asks
a research question.

## Reading the report

Read `topics/opportunities.md` or the dossier; not the whole repository and not
raw platform pages. For each candidate, report the dimensions separately:

```text
Repository novelty: high   (3 significant events after the last publication on it)
Evidence strength:  strong (code + tests + ADR)
Author overlap:     low    (briefly mentioned in "…", 2025-04-12)
Platform activity:  medium (related theme "Databases and storage": 10 of 71 articles, 30 days)
Saturation:         active
Trend:              stable
```

Preferred wording: *"This candidate has high repository novelty and low overlap
with your archive."* Never: "best topic", "#1", "you should write this", a 1–10
rank, or a combined score. The opportunity matrix (novelty × platform activity:
niche / active opportunity / low relevance / crowded-repetitive) is a map, not a
recommendation. Candidates are alphabetical on purpose.

Details: [references/opportunity-report.md](references/opportunity-report.md),
[references/repository-events.md](references/repository-events.md).

## Comparing and checking overlap

```bash
storyops topics compare "reconciliation receipts" "generic AI plugin" "Recall architecture"
storyops author overlap "<topic>"
```

Show the dimensions side by side; do not choose a winner.

## Decision rules

- Event types read from commit messages are hints (`basis: commit-message`);
  say so and ask the author to confirm in the code.
- Keep unknowns visible (no measurements, motivation not in the repository…).
- Pass the dossier's **questions for the author** on as questions; never answer
  them yourself or invent experiences, users, measurements or incidents.
- "Possible directions" are descriptive (e.g. "the failure: how it showed up"),
  never titles, hooks or section plans.
- Repository analysis is read-only and skips secret-like paths (`.env`, keys,
  credentials); never quote secret values.

## Failure behavior

- No repository configured → ask the author to add it under `projects` in
  `storyops.config.json` (id, name, path, glossary).
- No platform data → dimensions show `unknown`; suggest `storyops research
  platform <id>` or a dataset import. Do not guess activity.
- Empty archive → overlap is `none` for everything; say the archive is empty.
