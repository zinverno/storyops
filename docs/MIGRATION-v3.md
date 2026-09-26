# Migrating from v2 (editorial-kit) to StoryOps v3

StoryOps v3 is a deliberate product pivot. v2 researched, planned and
scaffolded articles (canonical story → brief → editorial direction → voice
plan → platform draft). v3 **does not write articles**. It researches,
discovers topics, and reviews what the author wrote:

```text
platform intelligence + author archive + repository intelligence
      ↓
topic landscape → opportunity discovery → topic dossier
      ↓
HUMAN WRITES ARTICLE
      ↓
read-only review → findings + local suggestions
```

## How to migrate a workspace

```bash
storyops migrate --dry-run   # lists what would be read; creates nothing
storyops migrate             # adds storyops.config.json, .storyops/ and the database
storyops doctor
```

`storyops migrate`:

- writes `storyops.config.json` (schemaVersion 2) from `editorial.config.json`,
  dropping `editorial` (its `defaultStyle` becomes `review.profile`) and
  `paths.articlesDir`;
- imports `.editorial/publications/**` into the database (author archive);
- imports every `.editorial/research/<date>/<platform>.json` snapshot as a
  research run (`origin: legacy-snapshot`), so research history starts with
  your old snapshots; the same file is never imported twice;
- imports `.editorial/projects/<id>/report.json` as a repository snapshot and
  extracts events and topics from it;
- converts workspace style presets `.editorial/styles/*.yaml` into review
  profiles in `.storyops/review-profiles/`;
- copies `.editorial/author-profile.json` (your manual notes) to `.storyops/author/`;
- adds `.storyops/cache/` and `.storyops/backups/` to `.gitignore`;
- writes `.storyops/migration-report.md`.

It never deletes or rewrites `editorial.config.json`, `.editorial/` or
`articles/`. **Old generated drafts** (`articles/<slug>/outputs/*.md`) are
user files: they stay where they are and are not imported as published
history. If one of them was actually published, import it explicitly:
`storyops author import <file> -p <platform> --date <iso> --url <url>`.

Without migrating, v3 still reads `editorial.config.json` (with a deprecation
warning), and old config fields are accepted and ignored with warnings.

## Commands

| v2 | v3 |
| --- | --- |
| `editorial-kit …` | `storyops …` (`editorial-kit` remains an alias for one release and prints a deprecation notice) |
| `research -p habr` | `research platform habr` (old form still works, deprecated) |
| `author sync`, `author import`, `author profile` | unchanged (+ `research author`) |
| `continuity` | `author coverage` (alias kept, deprecated); the continuity map is still written |
| `publications` | `author publications` (alias kept, deprecated) |
| `project inspect` | `repo inspect` (alias kept, deprecated) |
| `gap` / `narrative-gap` | `topics discover` (alias kept, deprecated) |
| `collision -t` | `author overlap` / `topics compare` (alias kept, deprecated) |
| `style <file>` | `review <file>` (alias kept, deprecated) |
| `styles list/show/validate` | `profiles list/show/validate` (alias kept, deprecated) |
| `story create/validate`, `brief`, `evidence`, `repurpose`, `create`, `editorial plan/validate/audit`, `input init/add/show` | **removed** — each prints why and what to use instead, exits with code 2 and does nothing |
| `screenshots plan`, `screenshots capture` | **removed** — screenshots are publication assets; StoryOps is analysis-only. The command prints why, exits with code 2 and does nothing. Capture screenshots with your own tooling (e.g. Playwright directly) |

## Component classification

| Component (v2) | Decision | v3 |
| --- | --- | --- |
| Author profile | retain | `src/author/profile.ts`; the manual section is "author notes", never a voice to imitate |
| Publication model, Markdown import, publication index | retain | `src/publications/*`; storage moved from JSON files to the database (`src/author/store.ts`) |
| Continuity map | retain | `src/continuity/*` (open threads feed author intelligence) |
| Platform research (HTTP client, robots, cache, momentum, structural features, Habr adapter) | retain, extend | conditional requests (ETag/Last-Modified), no re-download of bodies with stored features, more abstract features, history in the database |
| Research snapshots (files) | repurpose | research runs in the database; dated files remain as reports |
| Saturated angles | repurpose | topic saturation with dimensions and rule-based states (`src/topics/saturation.ts`) |
| Pattern extraction | retain | observations per run |
| Pattern transfer | repurpose | pattern report with history and "decision: left to the author" (`storyops patterns`) |
| Topic collision | retain and expand | duplicate-topic detection (`author overlap`) and `topics compare` |
| Narrative gap | repurpose | repository events + repository novelty (`src/repo/events.ts`, `src/opportunity/*`) |
| Project inspection, git classification | retain | input to repository intelligence |
| Similarity (TF-IDF/BM25) | retain | related publications, archive overlap |
| Style check and style profiles | repurpose | language and style findings of the review |
| Style presets (`styles/*.yaml`) | repurpose | review profiles (`review-profiles/*.yaml`) |
| Editorial audit, dryness, originality | repurpose | article review (`src/review/*`) |
| Author input (`author-input.md`) | repurpose | review input: MUST USE possibly missing, VERBATIM missing, DO NOT USE present |
| Platform strategies v1 | repurpose | strategy schema v2: analysis context and review fit, no draft skeletons |
| Screenshots capture | remove (0.3.0) | publication assets are outside the analysis-only boundary; `storyops screenshots …` is a tombstone. The last implementation is in the git history of v2 / early v3 (`src/screenshots/`) |
| Screenshot plans derived from stories | remove | — |
| Canonical story (`story.json`) | remove | replaced by the topic dossier (`topics/<id>/dossier.*`) as the last artifact before writing |
| Briefs | remove | — |
| Evidence mapping for story claims | remove | factual review against repository evidence (`review --repo`) |
| Editorial direction, voice plan, voice sample | remove | — |
| Draft workspace renderer, Telegram renderer, section skeletons | remove | — |
| Generation CLI (`repurpose`, `create`, `brief`, `story`, `editorial`, `input`) | deprecate (tombstones) | removed in the next release |
| Agent Skill `editorial-author` | remove (retired) | `storyops-review` covers the post-writing part |
| Agent Skill `editorial-research` | repurpose | `storyops-research` |
| Agent Skill `product-screenshots` | remove (retired) | no longer bundled or installed by `storyops skills install`; delete an installed copy yourself if you no longer need it |
| New | — | `storyops-opportunity` skill, SQLite database, topic model, trends, opportunity discovery, review |

## Data model changes

- Config: `schemaVersion` 2; new `topics`, `analysis`, `review`, `database`,
  `paths.dataDir/topicsDir/reviewsDir`; glossary entries may carry `id` and
  `related` (built-in themes for platform context).
- Workspace: `.storyops/` (database, cache, research reports, author,
  repositories, reports, backups, review profiles), `topics/`, `reviews/`.
  There is no article output directory.
- Config: the `screenshots` section is accepted with a deprecation warning and
  ignored; `storyops migrate` drops it from `storyops.config.json`.
- Environment: `STORYOPS_USER_AGENT_CONTACT`, `STORYOPS_LOG_LEVEL` (the
  `EDITORIAL_*` names are still honoured). `STORYOPS_CHROMIUM_PATH` /
  `EDITORIAL_CHROMIUM_PATH` are no longer used. Playwright is no longer a
  dependency.
- Review: the `storyops-review` skill adds a mandatory agent language/logic
  pass after the CLI report; the CLI checker itself stays deterministic and
  limited (selected Russian spelling, punctuation and style patterns).
