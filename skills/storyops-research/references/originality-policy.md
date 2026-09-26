# Originality policy

Research makes the author better informed. It never automates imitation.

## Allowed

- Structural observations (density, framing, placement, frequency) with sample sizes.
- Aggregated statistics (shares, medians, counts) with time ranges.
- Examples referenced by article id/URL as provenance.

## Forbidden

- Copying or paraphrasing sentences, paragraphs or openings of researched articles.
- Reusing distinctive phrases or catchphrases.
- Imitating a specific author's voice (including the user's own: StoryOps never writes "in the user's voice").
- Turning a successful title into a fill-in-the-blank template.

## How the tooling enforces it

- The database stores metadata, numbers and boolean/count features only.
  Article bodies are parsed in memory and discarded.
- Titles are kept only as provenance; they are not templates.
- Reports cite observations by id, sample and URL, never by quoting articles.
