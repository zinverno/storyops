# Repository events

`storyops repo inspect` reads git history, tags, docs, ADRs, changelog,
benchmarks, tests and the source tree (read-only; secret-like paths skipped)
and extracts candidate engineering events:

new-subsystem, removed-subsystem, failed-approach (removed within 90 days),
large-refactor, migration, bug-fix, architecture-split, state-model-change,
performance-work, new-persistence-layer, api-redesign, testing-strategy-change,
security-fix, new-integration, feature-reversal, limitation-discovered,
architecture-decision (ADR), release (tag).

Each event has: id, date range, type (+ aspects), summary, files, commits,
evidence refs (commit, file, test, doc, adr, tag, changelog, benchmark),
affected subsystem, evidence strength with the reasons, and **basis**:

| Basis | Meaning |
| --- | --- |
| paths | files added/removed in history; purpose not verified |
| commit-message | type inferred from the message; check the diff |
| docs | an ADR or benchmark file; may be outdated |
| tags | version boundary only |

`storyops repo events [--since 2026-01-01] [--type bug-fix,migration]` lists
them; `storyops repo topics` shows the repository topic map (events grouped by
glossary topic, or by module when no glossary term matches).

Treat event semantics as hypotheses. Say "the commit message suggests a
migration", not "the author migrated".
