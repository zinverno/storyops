# Evidence policy

```
EVIDENCE → STORY → ARTICLE        (never ARTICLE → look for evidence)
```

## Claim classification

| Classification | Meaning | Needs evidence |
| --- | --- | --- |
| `verified-fact` | Checked against code, tests, commits, docs, runtime output | **yes** |
| `interpretation` | The author's reading of verified facts | no, but must follow from facts |
| `opinion` | The author's view | no; phrase as opinion |
| `hypothesis` | Plausible, not checked | no; label as hypothesis |
| `future-plan` | Intended, not done | no; never phrase as done |
| `unverified` | Not yet checked | must be verified, relabelled or dropped before publishing |

## Acceptable evidence

Source files, tests, git commits, tags/releases, PR descriptions, ADRs, release
notes/changelog, runtime output, screenshots, benchmark files, documented
configuration, earlier publications (for "we said before…").

## Never invent

Benchmark values, performance improvements, users, customers, revenue,
production usage, adoption numbers, test counts, failures, personal experiences.

## Contradictions

Source and tests beat README. Recent history beats old docs. If a commit
message says "feat" but only docs changed, trust the files (`editorial-kit
project inspect` lists such mismatches).

## Tooling

- `editorial-kit evidence -s <story>` resolves every ref, stores excerpts and
  content hashes in `evidence.json`/`evidence.md`, and suggests candidate files
  (lexical search) for verified facts without evidence. Suggestions must be read before use.
- `editorial-kit evidence verify -s <story>` detects drift before publishing.
- Secret-like paths (`.env`, keys, credentials) are never read or used as evidence.
