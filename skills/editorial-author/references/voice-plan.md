# Voice plan

`editorial/voice-plan.json` (view: `voice-plan.md`) converts factual structure
into a living narrative. It answers:

- **What should the reader experience?** (`readerExperience`) Not "a description of the Health architecture",
  but e.g. "discovering that 'the problem disappeared' is a much harder statement than it looks".
- **What is the narrative movement?** (`narrativeMovement`, ordered beats). Example:
  1. restart/reconciliation anomaly → 2. why `updatedAt` looked reasonable → 3. one field, two meanings →
  4. Finding becomes durable → 5. coverage/freshness/receipts → 6. Health becomes a broader model →
  7. existing engines plug in → 8. limits: observation state, not truth.
- **Where does the conflict appear?** (`conflictPlacement`) **What context waits until after the hook?** (`delayedContext`)
- **Which technical details become episodes?** (`technicalEpisodes`)
- **Where does the author speak in the first person?** (`firstPersonMoments`, linked to author items when they are experiences)
- **Which author phrases and stories go where?** (`authorMaterial`: `planned` + `beatId`, or `omitted` + `reason`)
- **Where is humor appropriate?** (`humor`) **Where should the prose slow down?** (`slowDown`)
- **Which beats risk becoming documentation, and how to avoid it?** (`documentationRisks`)
- **Where do limitations appear naturally?** (`limitations[].beatId`), not as a dump at the end.

## Beats

```json
{ "id": "finding-gets-state", "summary": "…", "purpose": "the central episode", "mode": "scene", "pace": "slow",
  "claimIds": ["lifecycle-states"], "evidenceRefs": ["src/findings/lifecycle.ts"],
  "authorItemIds": ["verbatim-ef732b33"], "patternIds": ["body-code"], "visualIds": ["finding-lifecycle"] }
```

- `claimIds` must be canonical story claims. Trend patterns go in `patternIds`, never in `claimIds`.
- Modes: `scene`, `explanation`, `reflection`, `context`, `code`, `visual`, `transition`, `limitation`.
- Prefer `problem → attempt → friction → discovery → design consequence` when the evidence supports that sequence.
  Do not invent tension where the evidence shows a routine change.

## Calibration

`calibration.required` is true for long-form. Pick the central technical episode (`episode`), write
400–800 words to `editorial/voice-sample.md`, show it, and set `status` to `shown`/`approved`
(or `skipped` with `skipReason`). The question is: does this sound like the author, or like a generated summary?
