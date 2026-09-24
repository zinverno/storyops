# Originality policy

Trend research improves editorial judgement. It does not automate imitation.

## Allowed

- Structural patterns (e.g. "problem stated in the first section").
- Aggregated statistics (shares, medians, counts) with sample sizes.
- Abstract editorial observations with provenance.
- Presentation tendencies (code density, screenshot density, section count).

## Forbidden

- Copying paragraphs or sentences from researched articles.
- Light paraphrasing of another article.
- Reusing distinctive phrases or catchphrases.
- Imitating a specific author's voice.
- Taking a successful title and replacing the nouns.

## How the tooling enforces it

- Research snapshots store metadata, numbers and boolean/count features only.
  Article bodies are parsed in memory and discarded.
- Titles are kept only as provenance for observations; they are not templates.
- Briefs cite observations by id and sample, never by quoting articles.

If you notice yourself reaching for another article's wording, stop and write
from the canonical story instead.
