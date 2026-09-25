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

## Author decisions

`storyops findings list` / `storyops findings set F007 dismissed --note "…"`.
Statuses: open, accepted, dismissed, resolved. Dismissed and accepted
decisions carry over to later reviews of the same article (matched by a
fingerprint of rule + excerpt, not by line number).
