# Platforms

Each platform is a `PlatformModule` (`schema.ts`):

```ts
{ strategy: PlatformStrategy; research?: PlatformResearchAdapter }
```

A strategy (schema version 2) describes how to **analyse** a platform and how
to **review platform fit** of a human-written article: research capabilities
(live, author history, import), review context (typical length per article
kind, sections, code, images, generic-introduction and marketing tolerance,
conventions) and formatting constraints. Every rule is a `constraint` (a hard,
documented limit) or a `recommendation` (context). Nothing in a strategy
describes how to generate a publication, and no platform rule overrides the
author.

`registry.ts` validates every strategy against the shared schema when it is registered.

## Adding a platform

1. `platforms/<id>/strategy.ts` — a `PlatformStrategy`; cite sources for constraints.
2. Optional `research.ts` — `collectTrends` and/or `collectAuthorHistory` using the provided `HttpClient`
   (robots.txt, rate limits, caching, conditional requests). Only if reliable public access exists.
   Without it the platform is analysis-only: datasets can still be imported with `storyops research import`.
3. `platforms/<id>/index.ts` exporting the module, and one `.register(...)` line in `registry.ts`
   (or at runtime: `createDefaultRegistry().register(myPlatform)`).

No changes are needed in the database, topic, author, repository or review
layers. `tests/platform-registry.test.ts` registers a platform at runtime and
runs dataset import and trends with it to keep this true.
