import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { habrPlatform } from '../platforms/habr/index.js';
import { createDefaultRegistry } from '../platforms/registry.js';
import { buildBrief } from '../src/briefs/build.js';
import { renderBrief } from '../src/briefs/render.js';
import { HttpCache } from '../src/research/cache.js';
import { HttpClient } from '../src/research/http.js';
import { runTrendResearch } from '../src/research/runner.js';
import { findLatestSnapshot } from '../src/research/snapshot.js';
import { canonicalStorySchema } from '../src/stories/schema.js';
import { fixedClock } from '../src/shared/clock.js';
import { silentLogger } from '../src/shared/logger.js';
import { FIXTURES, ROOT, tempDir } from './helpers.js';

const clock = fixedClock('2026-09-24T12:00:00.000Z');

async function seededClient(dir: string, options: { offline?: boolean; failing?: boolean } = {}) {
  const cache = new HttpCache(path.join(dir, 'cache'), 24);
  const manifest = JSON.parse(await readFile(path.join(FIXTURES, 'habr/manifest.json'), 'utf8')) as { pages: Record<string, string> };
  for (const [url, file] of Object.entries(manifest.pages)) {
    await cache.set({ platform: 'habr', url, fetchedAt: clock.now().toISOString(), status: 200, body: await readFile(path.join(FIXTURES, 'habr', file), 'utf8') });
  }
  const failing = (async () => {
    throw new Error('network down');
  }) as typeof fetch;
  return new HttpClient({ cache, clock, logger: silentLogger, minDelayMs: 0, concurrency: 2, timeoutMs: 1000, sleep: async () => undefined, ...(options.offline ? { offline: true } : {}), ...(options.failing ? { fetchImpl: failing, refresh: true } : {}) });
}

describe('research runner', () => {
  let tmp: Awaited<ReturnType<typeof tempDir>>;
  beforeEach(async () => {
    tmp = await tempDir();
  });
  afterEach(async () => tmp.cleanup());

  it('writes a dated snapshot with provenance and limitations', async () => {
    const http = await seededClient(tmp.dir, { offline: true });
    const r = await runTrendResearch({ platform: habrPlatform, platformConfig: { enabled: true, periods: ['weekly'] }, researchDir: path.join(tmp.dir, 'research'), http, clock, logger: silentLogger });
    expect(r.files?.json).toMatch(/research\/2026-09-24\/habr\.json$/);
    const s = r.snapshot;
    expect(s.status).toBe('cache');
    expect(s.sources.length).toBeGreaterThan(0);
    expect(s.sources.every((x) => x.fromCache)).toBe(true);
    expect(s.limitations.join(' ')).toMatch(/Small sample/);
    expect(s.momentumFormula).toMatch(/Missing metrics are excluded/);
    const md = await readFile(r.files!.md, 'utf8');
    expect(md).toMatch(/Trend research is advisory/);
  });

  it('falls back to the previous snapshot and discloses its age when live research fails', async () => {
    const researchDir = path.join(tmp.dir, 'research');
    const ok = await seededClient(tmp.dir, { offline: true });
    await runTrendResearch({ platform: habrPlatform, platformConfig: { enabled: true, periods: ['weekly'] }, researchDir, http: ok, clock, logger: silentLogger });
    const later = fixedClock('2026-09-27T12:00:00.000Z');
    const emptyCacheClient = new HttpClient({ cache: new HttpCache(path.join(tmp.dir, 'empty-cache'), 24), clock: later, logger: silentLogger, minDelayMs: 0, concurrency: 1, timeoutMs: 100, sleep: async () => undefined, maxRetries: 0, fetchImpl: (async () => { throw new Error('network down'); }) as typeof fetch });
    const r = await runTrendResearch({ platform: habrPlatform, platformConfig: { enabled: true, periods: ['weekly'] }, researchDir, http: emptyCacheClient, clock: later, logger: silentLogger });
    expect(r.fallback?.ageHours).toBe(72);
    expect(r.fallback?.reason).toMatch(/network down|failed/);
    expect(r.snapshot.collectedAt).toBe('2026-09-24T12:00:00.000Z');
  });

  it('reports "live research unsupported" for platforms without an adapter', async () => {
    const http = await seededClient(tmp.dir, { offline: true });
    const r = await runTrendResearch({ platform: createDefaultRegistry().get('linkedin'), platformConfig: { enabled: true }, researchDir: path.join(tmp.dir, 'research'), http, clock, logger: silentLogger });
    expect(r.snapshot.status).toBe('unsupported');
    expect(r.snapshot.limitations[0]).toBe('live research unsupported');
    expect(await findLatestSnapshot(path.join(tmp.dir, 'research'), 'linkedin')).toBeUndefined();
  });
});

describe('article brief', () => {
  it('contains every required section and gates drafting on evidence', async () => {
    const story = canonicalStorySchema.parse(JSON.parse(await readFile(path.join(ROOT, 'examples/canonical-story.example.json'), 'utf8')));
    const brief = buildBrief({ story, strategy: createDefaultRegistry().get('habr').strategy, clock });
    expect(brief.readiness.readyForDrafting).toBe(false);
    expect(brief.readiness.blockers.join(' ')).toMatch(/Evidence has not been collected/);
    expect(brief.platformContext.status).toBe('no research snapshot');
    const md = renderBrief(brief);
    for (const heading of ['Working title', 'Platform', 'Publication type', 'Core question', 'Why this exists now', 'Target reader', 'Relation to previous publications', 'What has already been explained', 'What must not be re-explained', 'Narrative gap', 'Unique contribution', 'Current platform context', 'Main technical conflict', 'Important evidence', 'Screenshots required', 'Potential diagrams', 'Expected structure', 'Known limitations', 'Claims requiring verification', 'Platform-specific packaging notes']) {
      expect(md).toContain(`## ${heading}`);
    }
    expect(md).toMatch(/NOT READY FOR DRAFTING/);
  });

  it('marks trend-based packaging as advisory and cites the snapshot', async () => {
    const tmp = await tempDir();
    try {
      const http = await seededClient(tmp.dir, { offline: true });
      const { snapshot } = await runTrendResearch({ platform: habrPlatform, platformConfig: { enabled: true, periods: ['weekly'] }, researchDir: path.join(tmp.dir, 'research'), http, clock, logger: silentLogger, save: false });
      const story = canonicalStorySchema.parse(JSON.parse(await readFile(path.join(ROOT, 'examples/canonical-story.example.json'), 'utf8')));
      const brief = buildBrief({ story, strategy: habrPlatform.strategy, clock, snapshot: { snapshot, ageHours: 5 } });
      const trend = brief.packaging.filter((p) => p.source === 'trend-observation');
      expect(trend.length).toBeGreaterThan(0);
      expect(trend.every((p) => p.advisory && /snapshot 2026-09-24, 5h old/.test(p.provenance))).toBe(true);
      expect(brief.platformContext.status).toMatch(/cache snapshot from 2026-09-24 \(5h old\)/);
    } finally {
      await tmp.cleanup();
    }
  });
});
