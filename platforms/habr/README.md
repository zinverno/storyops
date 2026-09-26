# Habr

| Capability | Status |
| --- | --- |
| Strategy (analysis + review fit) | implemented (`strategy.ts`) |
| Live trend research | implemented (`research.ts`): public top lists per period (`/ru/articles/top/<period>/`) and per hub (`/ru/hubs/<hub>/articles/top/<period>/`) |
| Author history | implemented: public author article list (`/ru/users/<user>/articles/`, paginated as `…/articles/page2/`) + article pages |
| Dataset import | yes (`storyops research import`) |
| Deduplication | an article seen again is one article with a new metric observation; bodies with stored features are not re-downloaded; stale cache entries are revalidated with ETag/Last-Modified |

## Layout

- `selectors.ts` — every Habr CSS selector, with fallbacks. The only place to edit when markup changes.
- `parse-values.ts` — pure parsers for "12K" counts, vote breakdowns, Russian dates (Moscow time), article ids.
- `parser.ts` — HTML → list items / article metadata / platform-neutral content blocks.
- `research.ts` — URL patterns and the adapter (author history + trends).
- `strategy.ts` — stable platform characteristics for analysis and platform-fit review. Current activity is **not** here; it lives in the research history in the database.

## Behaviour

- Fetches go through the shared `HttpClient`: robots.txt is honoured, ≥ 1 s per-host delay
  (default 2 s), concurrency ≤ 4 (default 2), caching with TTL, stale-cache fallback with disclosure.
- 401/403 and anti-bot challenges stop the request; they are never worked around.
- Missing metrics (rating, views, bookmarks, comments) are recorded as warnings, not errors.
- Only metadata and abstract structural features of other authors' articles are stored.

## Verification status

The parser is tested against hand-written fixtures in `fixtures/habr/` that
approximate Habr's public markup. The live path could not be exercised from the
environment where this adapter was written (habr.com was not reachable). Before
relying on it, run `storyops research platform habr --verbose` and check the
report for parser warnings; if needed, compare a cached page
(`.storyops/cache/habr/`) with `selectors.ts`.
