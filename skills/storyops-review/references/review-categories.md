# Review categories

| Category | What the tool checks (deterministic) | Leave to the agent/human |
| --- | --- | --- |
| language | канцелярит with local alternatives («позволяет осуществлять», «данный», «на сегодняшний день»…), frequent misspellings, punctuation (space before comma, missing space, «но» without comma), repeated words in a sentence (subject terms exempt), overlong sentences | grammar in general, collocations, register |
| style | clichés, repeated triads, "не X, а Y" density, em-dash density, generic section openings, repeated conclusion formulas, identical paragraph rhythm, marketing words | tone, voice (never rewrite toward a voice) |
| logic | statement vs its negation with shared wording; absolute ("гарантирует/всегда") vs qualified ("только/лишь") statements about the same subject; before/after contrasts are skipped | argument structure, hidden assumptions |
| factual | claims with numbers, performance improvements, adoption, test counts, "removed/added X"; compared with benchmarks, docs, changelog, repository events and modules | anything outside the repository |
| repetition | near-duplicate paragraphs (cosine ≥ 0.6), 4-word phrases repeated ≥ 3 times, a concept defined twice | repeated ideas in different words |
| structure | long introduction, dense paragraphs/sections, empty sections, heading/content mismatch, conclusion introducing new numbers, definition after first use, review-profile expectations | section order, pacing |
| clarity | undefined acronyms, long parentheticals, pronoun at the start of a paragraph after a heading | audience fit |
| platform-fit | documented constraints (e.g. 4096 characters on Telegram), typical length, structure vs sample medians, crowded topics, opening pattern vs high-momentum sample | none of it overrides the author |
| archive | a section substantially repeating one of the author's publications (what repeats, what is new) | whether the repetition is useful |
| author-input | MUST USE item possibly missing (lexical), VERBATIM phrase missing, DO NOT USE phrase present | paraphrased coverage |

## Evidence statuses

| Status | Meaning |
| --- | --- |
| supported | the number or fact appears in repository material |
| partially-supported | related material exists, but not this number/implication |
| unsupported | nothing in the repository supports it (e.g. "3× faster" and no benchmark) |
| contradicted | the repository says otherwise (e.g. "removed X" while X exists) |
| needs-human-confirmation | not checkable in a repository (users, production, coverage), or no `--repo` |

## Severity

`info` < `suggestion` < `warning` < `error`. `error` is reserved for
contradicted facts and similar clear-cut problems; do not overuse it.
