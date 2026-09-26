# Opportunity report

`storyops topics discover` → `topics/opportunities.md` + `.json`. Candidates are
project topics (config glossary, config topics with specificity `project`,
repository modules) that have at least one repository event.

## Dimensions (never collapsed into one score)

| Dimension | Values | Rule |
| --- | --- | --- |
| Repository novelty | high / medium / low | high: a significant event after the last publication on the topic (new subsystem, state-model change, persistence, split, migration, removal/failed approach, API redesign, security fix, ADR, limitation, or a bug fix/refactor with code and tests); medium: only minor events after it; low: nothing new |
| Evidence strength | strong / moderate / weak / none | strongest event: ≥ 4 independent signals strong, ≥ 2 moderate; message-only types stay weak |
| Author overlap | none / low / medium / high | coverage map: not covered / briefly mentioned / covered / deeply covered |
| Platform activity | unknown / low / medium / high | from the saturation state of the topic or its related theme: sparse → low, emerging/active → medium, crowded/highly saturated → high |
| Saturation | state + reasons | see the storyops-research skill |
| Trend direction | rising / stable / declining / insufficient-history | research history |
| Technical specificity | high / medium / low | project topic with code+tests / project topic or technology / generic framing |
| Recency | recent (≤ 90 d) / this-year / older | last repository event |

Platform context comes from the topic itself when the platform sample contains
it; otherwise from its **related** built-in themes (config `related`, or
built-in topics matched by the same repository events). Reports say which.

## Matrix

```text
                         PLATFORM ACTIVITY
                    low                high/medium
REPO NOVELTY high   niche              active opportunity
             low    low relevance      crowded/repetitive
```

## Topic dossier

`storyops topics show <id>` → `topics/<id>/dossier.{md,json}`: topic,
repository evidence (events with refs), why it may be technically interesting,
what changed, author coverage (what is covered, what is genuinely new), similar
publications, platform landscape, related structural patterns, possible
directions, risks, questions for the author, unknowns. No narrative plan.
