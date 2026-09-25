# Editorial audit

After fact-checking a draft:

```bash
editorial-kit editorial audit --story articles/<slug>/story.json --platform habr --output articles/<slug>/outputs/habr.md
```

Writes `editorial/audit.json` and `audit.md` (summary, per-item status, pattern usage, dryness and style
warnings, originality check, and a ¶ paragraph index of the draft).

## What is deterministic

- **VERBATIM**: the exact phrase must be in the publishable text (frontmatter and HTML comments excluded).
  Only whitespace/line wrapping is normalised. Absent or reworded → error.
- **DO NOT USE**: literal, case-insensitive, whole-word hits → error.
- **Locations** you record must exist (paragraph/line ranges, headings) and contain your `excerpt`.

## What you record

Edit `material[]` and `patterns[]` in `audit.json`, then re-run the audit:

```json
{ "itemId": "must-757952b8", "status": "incorporated", "location": { "paragraphs": [1, 1], "excerpt": "ничего не помнил" } }
{ "itemId": "should-59e18988", "status": "omitted", "reason": "No story claim yet." }
{ "patternId": "body-conflict-early", "status": "incorporated", "location": { "paragraphs": [1, 2] } }
{ "patternId": "title-conflict", "status": "overridden-by-author", "reason": "The author wants a plain title." }
{ "itemId": "avoid-bbf260fc", "semanticReview": "clear" }
```

| Item | No record | Omitted with reason |
| --- | --- | --- |
| MUST | error | warning (surfaced) |
| SHOULD | warning | ok |
| MAY / raw notes | ok | ok |
| BACKGROUND | ok (publishing it is flagged for confirmation) | ok |
| Applied pattern | warning | `overridden-by-author` with a note is valid |

Mappings are kept between runs; when the draft changes, stale locations fail their check and must be updated.

## Voice and dryness

Warnings for list density, heading density, runs of very short paragraphs, headings that mirror story fields,
scaffold labels, repeated definition-first openings, repeated sentence openings, missing first person in a
first-person style, plus the style profile (em dashes, "не X, а Y", triads, clichés). Findings inside an author
VERBATIM phrase are marked author-provided.

These are editorial signals, not truth. There is no score. Never rewrite prose mechanically to silence a
metric; read the paragraph and decide. Passing the audit does not prove the prose is good.
