# Pattern transfer

Answers one question: **which abstract observations from current platform
research are actually used in this article, and where?**

```
trend research → abstract pattern → editorial decision
```

never `successful article → imitate article`.

## Input: the compressed snapshot only

`editorial plan` copies observations and saturated angles from the latest research snapshot into
`editorial/pattern-transfer.json` with strength, sample size, window, limitations and supporting
article ids. Work from that artifact. Do not re-read researched article bodies; open an individual
external article only to verify a specific observation, and say why.

## Decide each item

| Field | Content |
| --- | --- |
| `decision` | `apply`, `adapt` or `skip` (`pending` blocks validation) |
| `decidedBy` | `agent` or `author` (`rule` = weak observations skipped by default) |
| `rationale` | Why, for this story. Always required. |
| `skipReason` | `weak-sample`, `does-not-fit-story`, `not-supported-by-evidence`, `would-create-clickbait`, `conflicts-with-author-voice`, `overridden-by-author-input`, `other` |
| `placement` | Where: `title`, `opening`, `beat:<id>`, a section. Required for apply/adapt. |
| `consequence` | The concrete editorial consequence ("open with the updatedAt conflict before the history"). Required for apply/adapt. |
| `safeguards` | Item-specific extras; artifact-wide safeguards already forbid copying. |
| `conflictsWithAuthorItems` | Author input ids this pattern conflicts with. Applying over a MUST/VERBATIM/DO NOT USE item is an error. |

Example:

```
body-conflict-early (moderate, N=11): higher-momentum articles describe a concrete problem in the first 150 words.
decision: apply
placement: opening, beat:restart-anomaly
consequence: open with the updatedAt/reconciliation problem before the longer project history.
```

## Skipping is a good outcome

Skip when the observation is weak, does not fit the story, needs evidence you do not have (e.g. measurements),
would create clickbait, conflicts with the author's voice, or author input overrides it. Write the reason.

## Originality

- Store abstract patterns only. Never copy titles, passages or openings; never swap nouns in a successful title.
  Validation rejects wording shared with researched titles.
- Never imitate one specific author.
- Trends never become facts: a beat's `claimIds` may only contain canonical story claims.

After drafting, map each applied pattern to where it shaped the article (`editorial audit`).
