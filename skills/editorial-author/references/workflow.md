# Workflow details

## 0. Workspace

```bash
editorial-kit init --author "Имя Фамилия" --habr https://habr.com/ru/users/<username>/
# edit editorial.config.json: projects[].path, aliases, glossary
editorial-kit doctor
```

The **glossary** matters: it maps code identifiers to publication vocabulary
(`{ "term": "модель здоровья", "aliases": ["health"] }`) so that the narrative
gap can tell whether `src/health/` was already explained to readers.

## 1–6. Author memory and continuity

```bash
editorial-kit author sync                 # live: Habr public profile pages (cached, robots.txt honoured)
editorial-kit author import post.md -p telegram --date 2025-04-12 --url https://t.me/...
editorial-kit continuity                  # .editorial/continuity.md
```

Read `.editorial/continuity.md` before anything else: chronology, what was
explained (and where), promises to readers, open questions.

## 7–10. Project, gap, research, collision

```bash
editorial-kit project inspect             # .editorial/projects/<id>/report.md
editorial-kit gap                         # .editorial/projects/<id>/narrative-gap.md
editorial-kit research -p habr            # optional, advisory
editorial-kit collision -t "<working topic>"
```

Choosing the topic: combine gap strength (evidence), what readers were promised
(open threads), what the user wants, and collision results. A strong gap backed
by tests and docs beats the most recent commit.

## 11–13. Story, brief, evidence

```bash
editorial-kit story create -t "<topic>" --slug <slug>
# fill story.json from evidence (see canonical-story.md)
editorial-kit evidence -s articles/<slug>/story.json
editorial-kit story validate articles/<slug>/story.json
editorial-kit brief -s articles/<slug>/story.json -p habr --type architecture-deep-dive
```

Loop until `story validate` reports "Ready for drafting" and `evidence.md` has no errors.

## 14–15. Screenshots

Use the product-screenshots skill: plan from `possibleVisuals`, capture with
`editorial-kit screenshots capture --plan …`. Reference captured images as
`screenshot:<file>` evidence in the story when they prove a claim.

## 16. Drafting

```bash
editorial-kit repurpose articles/<slug>/story.json -p habr --type architecture-deep-dive
```

The draft workspace lists, per section, the purpose and the story facts it may
use. Replace the TODOs with prose; delete the HTML comments before publishing.
Sections without story facts are omitted, not padded.

For another platform, run `repurpose` again with another `-p`. Read the story
again; do not open the other outputs.

## 17–20. Verification

1. Fact-check (fact-check.md).
2. Continuity: compare with the brief's "must not be re-explained" list.
3. `editorial-kit style articles/<slug>/outputs/<platform>.md`.
4. `editorial-kit evidence verify -s articles/<slug>/story.json` right before publishing (detects drift).

Publishing itself is manual in v1.
