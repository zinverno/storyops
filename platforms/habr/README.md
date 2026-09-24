# Habr

| Capability | Status |
| --- | --- |
| Strategy | implemented (`strategy.ts`) |
| Live trend research | implemented (`research.ts`): public top lists per period (`/ru/articles/top/<period>/`) and per hub (`/ru/hubs/<hub>/articles/top/<period>/`) |
| Author history | implemented: public profile list (`/ru/users/<user>/publications/articles/`) + article pages |
| Renderer | default scaffold renderer |

## Layout

- `selectors.ts` — every Habr CSS selector, with fallbacks. The only place to edit when markup changes.
- `parse-values.ts` — pure parsers for "12K" counts, vote breakdowns, Russian dates (Moscow time), article ids.
- `parser.ts` — HTML → list items / article metadata / platform-neutral content blocks.
- `research.ts` — URL patterns and the adapter (author history + trends).
- `strategy.ts` — stable editorial characteristics. Current trends are **not** here; they live in dated snapshots.

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
relying on it, run `editorial-kit research -p habr --verbose` and check the
snapshot for parser warnings; if needed, compare a cached page
(`.editorial/cache/habr/`) with `selectors.ts`.
