# Editorial direction

`editorial/direction.json` (view: `direction.md`) is the specific editorial
decision for this article on this platform. The CLI prefills references,
provenance, the style, the length range, author material that must / must not
appear, candidate voice samples, visuals and detected conflicts. You fill:

| Field | Question | Example |
| --- | --- | --- |
| `readerPromise` | What does the reader get? | "Show how a simple persistence problem exposed that user attention and analysis state were different concepts." |
| `coreAngle` | Why tell this now, this way? | from the narrative gap, not from a trend |
| `primaryConflict` | What is the article built around? | the real, evidenced engineering conflict |
| `secondaryThemes` | What else matters? | 1–3 items |
| `notAbout` | What is it NOT? (at least one) | "A feature list for Veynrel Health." |
| `openingApproach` | How does it open? | conflict first, history after |
| `narrativeEmphasis` | Where does it dwell / pass quickly? | |
| `technicalDepth`, `personalDepth` | Confirm against style + platform + author input | |
| `humorPolicy`, `codePolicy`, `visualPolicy` | Concrete policies | "one joke, from the author" |
| `lengthRange` | Prefilled from the platform strategy; adjust with reason | |
| `authorVoiceReferences.selected` | ≤ 3 of the author's own publications (from `candidates`) as voice samples | `use`: rhythm, first-person usage, transitions, humor. `reusable: true` only if the author allows exact reuse. |
| `visuals[].section`, `.claim` | Which section and which story claim each screenshot/diagram supports | |
| `conflicts[].resolution` | How each surfaced conflict is resolved, and by whom | |

Rules:

- Replace every `TODO(agent)`; unresolved fields block `editorial validate`.
- Do not copy story fields into the direction; make decisions about them.
- Author voice outranks the style preset; the preset outranks platform strategy; trends come last.
- If `reviewRequired` is non-empty, an input changed: review the affected fields, then empty the list.
