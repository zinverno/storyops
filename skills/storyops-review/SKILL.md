---
name: storyops-review
description: Read-only review of an article the author wrote. Runs the deterministic StoryOps CLI review (selected language patterns, style patterns, logic hints, factual claims checked against repository evidence, repetition, structure, clarity, platform fit), then a mandatory separate agent pass for spelling, grammar, awkward wording, unclear references, broken transitions and logical gaps. Every finding has a location, an explanation and at most one short local alternative. Use when the author asks for feedback, proofreading, a fact check or a pre-publication review of their own draft. It never rewrites, completes, restyles or saves the article.
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
- The author decides. Record decisions with
  `storyops findings set <id> accepted|dismissed|resolved`; dismissed findings
  stay dismissed in later reviews of the same article.

## Mandatory agent pass (after the CLI report)

The CLI checker is deterministic and intentionally limited: its language rules
cover only selected Russian spelling, punctuation and style patterns, and its
logic rules are lexical hints. **A CLI-only report is not proofreading** and
must never be presented as comprehensive.

After reading `review.md` you MUST do a separate read-only pass over the
author's text and look for:

1. spelling;
2. grammar;
3. awkward wording;
4. unclear references (what does "это", "он", "the system" point to?);
5. broken transitions between sentences and paragraphs;
6. logical gaps and contradictions the deterministic rules did not catch.

Rules for this pass (the same review contract as the CLI):

- Each finding has: **location** (line or quoted excerpt), **possible issue**,
  **why it may matter**, **suggested direction**, and **at most one short
  local alternative** (a word, a phrase or one short sentence).
- Never rewrite a paragraph, a section or the article. Never output a
  corrected full text, even when there are many small errors: list them.
- Use the CLI labels (Possible issue / Why it may matter / Possible change /
  Possible local alternative). Mark these findings `agent pass` so the author
  can tell them from the CLI findings; do not repeat CLI findings.
- Do not edit or save the article file.
- If you find nothing in a category, say so briefly. Do not claim the text is
  error-free.

```text
L23 · agent pass · unclear reference
Possible issue: «Он пересчитывается при старте» — неясно, что именно: индекс или отчёт.
Why it may matter: в предыдущем абзаце упомянуты оба.
Possible change: назвать объект явно.
Possible local alternative: «Индекс пересчитывается при старте».
```

Details and limits: [references/boundaries.md](references/boundaries.md).
