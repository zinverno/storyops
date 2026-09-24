# Author history

## Sources

| Platform | How | Notes |
| --- | --- | --- |
| Habr | `editorial-kit author sync` | Public profile publication list + article pages. Cached; robots.txt honoured; rate-limited. |
| Telegram, LinkedIn, Medium, blog | `editorial-kit author import <file.md> -p <platform>` | Markdown with frontmatter: `title`, `date`, `url`, `tags`, `projects`, `depth` (`brief`/`standard`/`deep`). |

Metrics are optional everywhere. Missing views/rating never break indexing.

## Publication index (`.editorial/publications/index.json`)

Per publication, deterministic heuristics derive: projects, roles
(`project-introduction`, `architecture`, `update`, `postmortem`, …), main
subject, candidate thesis, concepts (with `mentioned`/`explained`), architecture
described, problems introduced, results reported, future plans, open questions.

Each derived field has `method`: `heuristic`, `unresolved` (for you to fill),
`agent` or `manual`. When you interpret a field, write it back with
`method: "agent"` and keep the heuristic evidence in mind.

## Depth

`brief` (< 120 words, or < 250 words without sections), `deep` (≥ 1200 words, or ≥ 700 with ≥ 3 sections), otherwise
`standard`. Override with frontmatter `depth:` on import. Depth decides whether
a concept counts as *explained* in continuity.

## Continuity questions to answer

- What was the last in-depth publication about this project, and what did it claim?
- Which concepts are explained vs only mentioned (and where)?
- Which promises are open? Which are possibly addressed (verify)?
- Which story is being continued?
