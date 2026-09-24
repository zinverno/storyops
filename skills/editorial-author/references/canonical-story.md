# Canonical story

`articles/<slug>/story.json` — schema version 1 (`src/stories/schema.ts`). It is
**not** a publication. It is the factual and narrative source material that
every platform output is written from.

## Fields

| Field | Content | Evidence |
| --- | --- | --- |
| `context` | What the project is, in two sentences | manifest/README |
| `previousState` | What readers last saw (from the continued publication) | `publication:<id>` |
| `problem` | The real engineering problem | code, ADR, issue, commits |
| `constraints` | What limited the solution | ADR, docs |
| `turningPoint` | The moment/decision that changed direction | ADR, commit |
| `solution` | What was built | source files |
| `technicalDecisions[]` | decision, why, alternatives, evidence refs | required refs |
| `failedOrInsufficientApproaches[]` | only real ones, with evidence | required refs |
| `measurements[]` | what, value, unit, method, evidence | **required** refs |
| `results[]` | outcomes | **required** refs |
| `limitations`, `openQuestions` | honest boundaries | |
| `relationToPreviousPublications` | continues / updates / corrects / references | filled by `story create` |
| `narrativeGap` | why this story exists now | from `editorial-kit gap` |
| `possibleVisuals[]` | screenshot/diagram/code with **purpose** | |
| `claims[]` | id, text, classification, evidence refs | see evidence-policy.md |
| `pending` | fields still to write; empty when done | |

## Evidence references

`src/a.ts`, `src/a.ts#L10-L40`, `src/dir/`, `commit:<hash>`, `tag:v1.2.0`,
`publication:habr:812345`, `screenshot:01-dashboard.png`, `https://…` (recorded, not fetched).

## Status

`skeleton` (generated) → `draft` (narrative written, evidence attached) →
`verified` (fact-checked, `pending` empty).

## Rules

- Write fields from evidence, not from memory or from a draft article.
- If a field has no evidence, leave it empty rather than guessing; the scaffolds omit empty sections.
- Plans go to `claims` with `classification: "future-plan"` and to `openQuestions`, never to `results`.
