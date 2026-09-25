# Style presets

A style preset says **what kind of piece** this is. It is not the author's
voice (that comes from `.editorial/author-profile.md` and author input), not the
platform strategy, and not a trend.

```bash
editorial-kit styles list
editorial-kit styles show engineering-story
editorial-kit styles validate
```

Built-in: `engineering-story`, `architecture-deep-dive`, `dev-diary`, `postmortem`,
`tutorial`, `product-story`, `technical-essay`, `release-retrospective`.
Each defines perspective, narrative mode, technical/context depth, pacing, opening and
section behaviour, code/visual usage, humor level, personal presence, failure and
limitation handling, preferred and avoided patterns, and suitable publication types.

## Choosing

1. The user named a style → use it (`--style <id>`, recorded as `chosenBy: user`).
2. Otherwise → `editorial plan` without `--style` lists up to four candidates for the publication type.
   Propose two or three with one line each, based on the story, publication type, platform and intent.
   Do not dump the whole catalog.
3. The user said to proceed autonomously → pick one, set `style.chosenBy: "agent"` and a one-sentence
   `style.rationale` in `direction.json`, then re-run `editorial plan --style <id>`.

Style selection is not trend selection: a structure that is popular this week does not become the style.

## Rules

- A preset never overrides the author's voice or explicit author material. When they conflict
  (e.g. `personalPresence: none` but the author supplied personal context), the conflict is listed and
  author material wins.
- A preset never licenses invented facts, emotions or incidents (a postmortem needs a real incident).
- `postmortem` only for incidents documented in evidence.

## Custom presets

Copy a built-in YAML to `.editorial/styles/<new-id>.yaml`, change `id` (must equal the file name) and the
fields. Validation is strict (unknown fields and duplicate ids are rejected). No code changes are needed.
A workspace can set `"editorial": { "defaultStyle": "<id>" }` in `editorial.config.json`; it is optional.
