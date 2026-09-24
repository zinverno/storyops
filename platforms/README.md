# Platforms

Each platform is a `PlatformModule` (`schema.ts`):

```ts
{ strategy: PlatformStrategy; research?: PlatformResearchAdapter; renderer?: PlatformRenderer }
```

`registry.ts` validates every strategy against the shared schema when it is registered.

## Adding a platform

1. `platforms/<id>/strategy.ts` — a `PlatformStrategy` (mark each rule `constraint` or `recommendation`, cite sources).
2. Optional `research.ts` — implement `collectTrends` and/or `collectAuthorHistory` using the provided `HttpClient`
   (it handles robots.txt, rate limits and caching). Only if reliable public access exists.
3. Optional `renderer.ts` — a custom draft-workspace renderer (see `telegram/renderer.ts`).
4. `platforms/<id>/index.ts` exporting the module, and one `.register(...)` line in `registry.ts`
   (or register it at runtime: `createDefaultRegistry().register(myPlatform)`).

No changes are needed in author memory, continuity, project research, narrative
gap, canonical stories, evidence or screenshots. `tests/platform-registry.test.ts`
registers a new platform at runtime and runs the repurpose workflow with it to
keep this true.
