---
name: storyops-review
description: Read-only review of an article the author wrote, with the StoryOps CLI. Reports language problems (Russian first), style patterns, logical inconsistencies, factual claims checked against repository evidence, repetition (inside the article and against the author's earlier publications), structure, clarity and platform fit, each with a location, an explanation and at most one short local alternative. Use when the author asks for feedback, proofreading, a fact check or a pre-publication review of their own draft. It never rewrites, completes, restyles or saves the article.
license: MIT
compatibility: Needs the storyops CLI (Node.js 20.19+). Works offline; --repo needs a configured repository, --platform needs earlier research runs. No paid AI APIs.
metadata:
  version: "0.3.0"
  repository: "https://github.com/zinverno/storyops"
---

# storyops-review

**StoryOps reviews. The human writes.** The review is strictly read-only.

## Never

- rewrite the article, a section or a whole paragraph;
- complete unfinished prose, write an introduction or a conclusion;
- produce a "clean" or "final" version, or apply changes to the file;
- imitate the author's voice or "polish" the text into another style;
- repurpose the article for another platform.

If asked to write or rewrite the article, answer:
*"I can research the topic, show evidence and review a draft you write."*
Then offer the review.

## Run

```bash
storyops review article.md                       # language, style, logic, factual, repetition, structure, clarity, archive
storyops review article.md --repo <id>           # + claims vs repository evidence
storyops review article.md --platform habr       # + platform context (never a rule)
storyops review article.md --profile engineering-story --input author-input.md
```

Output: `reviews/<article>-<date>/review.{md,json}`. The article file is read
once and verified byte-identical afterwards. Read `review.md`; open the article
only at the reported lines.

## How to present findings

For each finding: **identify, explain, suggest, optionally one local alternative.**

```text
L42 · language · suggestion
Possible issue: канцелярит «данная система позволяет осуществлять анализ».
Why it may matter: отглагольное существительное делает фразу длиннее.
Possible change: сделать фразу короче и прямее.
Possible local alternative: «система анализирует».
```

- Use "Possible issue" / "Possible change". Never "You must rewrite this as".
- One local alternative at most, for the excerpt only (a phrase or one short
  sentence). Never a replacement paragraph.
- Factual findings carry an evidence status: supported, partially-supported,
  unsupported, contradicted, needs-human-confirmation. Do not claim exhaustive
  fact checking. Details: [references/review-categories.md](references/review-categories.md).
- Style findings are observable patterns (triads, "не X, а Y", em dashes,
  generic openings…). Never call them an "AI probability".
- Logic findings from the tool are lexical hints; add your own reading of the
  argument as separate, clearly marked observations.
- The author decides. Record decisions with
  `storyops findings set <id> accepted|dismissed|resolved`; dismissed findings
  stay dismissed in later reviews of the same article.

## Agent review on top of the tool

You may add findings the heuristics cannot see (a missing step in the argument,
an unclear guarantee, a claim that needs a source). Use the same format and
the same limits: location, problem, why, suggestion, at most one local
alternative. See [references/boundaries.md](references/boundaries.md).
