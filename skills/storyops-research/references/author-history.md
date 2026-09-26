# Author history and coverage

## Sources

| Platform | How | Notes |
| --- | --- | --- |
| Habr | `storyops author sync` | Public profile publication list + article pages. Cached; robots.txt honoured; rate-limited. |
| Telegram, LinkedIn, Medium, blog | `storyops author import <file.md> -p <platform>` | Markdown with frontmatter: `title`, `date`, `url`, `tags`, `projects`, `depth` (`brief`/`standard`/`deep`). |

Only import what the author actually PUBLISHED. Unpublished drafts (including
old v2 draft workspaces) are not publications.

## Coverage map

`storyops author coverage` → `.storyops/author/coverage.md`. For every topic
(built-in taxonomy, config topics, project glossary, repository modules) and
publication:

| Level | Rule |
| --- | --- |
| briefly mentioned | any occurrence (brief posts never count as more) |
| covered | non-brief publication, topic in the title/a heading or ≥ 3 occurrences |
| deeply covered | non-brief, in the title or a heading, ≥ 5 occurrences |

Flags: **revisited** (covered in ≥ 2 publications), **possibly outdated**
(repository changed on the topic after the last publication, or older than
`analysis.outdatedAfterDays`).

## Depth

`brief` (< 120 words, or < 250 words without sections), `deep` (≥ 1200 words,
or ≥ 700 with ≥ 3 sections), otherwise `standard`. Override with frontmatter
`depth:` on import.

## Questions to answer

- What was the last in-depth publication on this topic, and when?
- Which concepts are covered vs only mentioned?
- Which open promises exist (continuity map `.storyops/author/continuity.md`)?
