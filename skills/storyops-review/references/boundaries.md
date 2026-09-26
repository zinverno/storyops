# Suggestion boundaries

The article belongs to the author. A review may point, explain and suggest.

## Allowed

- One local alternative per finding, for the flagged excerpt only:
  a word, a phrase, or one short sentence (the tool drops alternatives longer
  than `review.maxAlternativeChars`, default 240 characters, or much longer than
  the excerpt).
- Structural suggestions as descriptions: "the definition of X comes after two
  uses", "these two paragraphs say the same thing". Not a new section plan.
- Questions: "Was this measured? How?"

## Not allowed

- Rewritten paragraphs, sections or the whole article.
- New introductions, conclusions, transitions or "improved" openings.
- Text "in the author's voice", or restyled toward a trend.
- Editing or saving the article file; creating `article.md`, `draft.md` or any
  new version of the article.
- Removing duplicated content on the author's behalf: report both places.

## CLI checks versus the agent pass

The CLI language checker is deterministic and deliberately narrow (selected
Russian spelling, punctuation and style patterns); its logic rules are lexical
hints. It does not claim comprehensive proofreading, grammar checking, logic
checking or fact checking.

That is why the skill requires a separate agent pass after every CLI report
(spelling, grammar, awkward wording, unclear references, broken transitions,
logical gaps). The agent pass follows exactly the rules above: location,
possible issue, why it may matter, suggested direction, at most one short
local alternative, and never a rewritten paragraph, section or article.

## Author decisions

`storyops findings list` / `storyops findings set F007 dismissed --note "…"`.
Statuses: open, accepted, dismissed, resolved. Dismissed and accepted
decisions carry over to later reviews of the same article (matched by a
fingerprint of rule + excerpt, not by line number).
