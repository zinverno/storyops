import { describe, expect, it } from 'vitest';
import { analysisConfigSchema, trendSettingsSchema } from '../src/config/schema.js';
import { openMemoryDatabase } from '../src/db/database.js';
import { trendFor } from '../src/platform/analytics.js';
import { ensurePlatform, recordResearchRun } from '../src/platform/store.js';
import { RESEARCH_SNAPSHOT_SCHEMA_VERSION, type ResearchSnapshot, type TrendArticle } from '../src/research/types.js';
import { fixedClock } from '../src/shared/clock.js';
import { compileStoredTopics, loadTopics, recordTrendSnapshots, syncTopics, tagPlatformArticles, workspaceTopics } from '../src/topics/registry.js';
import { trendDirection } from '../src/topics/trends.js';

const settings = trendSettingsSchema.parse({});
const WEEKS = ['2026-09-03T12:00:00.000Z', '2026-09-10T12:00:00.000Z', '2026-09-17T12:00:00.000Z', '2026-09-24T12:00:00.000Z'];

describe('trend direction', () => {
  it('rising: 5 → 8 → 14 → 20 AI articles per weekly sample of 40', () => {
    const obs = [5, 8, 14, 20].map((count, i) => ({ at: WEEKS[i]!, count, sample: 40 }));
    const r = trendDirection(obs, settings, { basis: 'research-runs' });
    expect(r.direction).toBe('rising');
    expect(r.timeRange).toEqual({ from: '2026-08-27T12:00:00.000Z', to: '2026-09-24T12:00:00.000Z' });
    expect(r.sampleSize).toBe(160);
    expect(r.comparison.earlier).toMatchObject({ buckets: 2, count: 13, sample: 80 });
    expect(r.comparison.later).toMatchObject({ buckets: 2, count: 34, sample: 80 });
    expect(r.because[0]).toMatch(/share 16% .* vs 43%/);
  });

  it('depends on the configured windows, not on the topic: one 28-day bucket has no history', () => {
    const obs = [5, 8, 14, 20].map((count, i) => ({ at: WEEKS[i]!, count, sample: 40 }));
    const wide = trendDirection(obs, { ...settings, windowDays: 28 }, { basis: 'research-runs' });
    expect(wide.direction).toBe('insufficient-history');
    expect(wide.because[0]).toMatch(/1 usable 28-day bucket/);
    const fewerPoints = trendDirection(obs, { ...settings, minPoints: 5 }, { basis: 'research-runs' });
    expect(fewerPoints.direction).toBe('insufficient-history');
  });

  it('declining and stable', () => {
    expect(trendDirection([20, 14, 8, 5].map((count, i) => ({ at: WEEKS[i]!, count, sample: 40 })), settings, { basis: 'research-runs' }).direction).toBe('declining');
    expect(trendDirection([10, 11, 10, 11].map((count, i) => ({ at: WEEKS[i]!, count, sample: 40 })), settings, { basis: 'research-runs' }).direction).toBe('stable');
  });

  it('ignores buckets that are too small and topics with too few articles', () => {
    const tiny = trendDirection([1, 1, 1, 1].map((count, i) => ({ at: WEEKS[i]!, count, sample: 3 })), settings, { basis: 'research-runs' });
    expect(tiny.direction).toBe('insufficient-history');
    expect(tiny.buckets.every((b) => !b.usable)).toBe(true);
    const rare = trendDirection([0, 0, 1, 2].map((count, i) => ({ at: WEEKS[i]!, count, sample: 40 })), settings, { basis: 'research-runs' });
    expect(rare.direction).toBe('insufficient-history');
    expect(rare.because[0]).toMatch(/only 3 topic article\(s\)/);
  });

  it('is computed from research runs stored in the database', async () => {
    const clock = fixedClock('2026-09-24T12:00:00.000Z');
    const db = await openMemoryDatabase({ clock });
    syncTopics(db, workspaceTopics({ topics: [], projects: [] }), clock.now().toISOString());
    ensurePlatform(db, { id: 'habr', displayName: 'Habr', research: { liveResearch: 'implemented' } }, clock.now().toISOString());
    let id = 0;
    [5, 8, 14, 20].forEach((ai, w) => {
      const articles: TrendArticle[] = [];
      for (let i = 0; i < 40; i += 1) {
        id += 1;
        const title = i < ai ? `Как ИИ помогает в задаче ${id}` : `Про базы данных, часть ${id}`;
        articles.push({ id: `habr:${id}`, platform: 'habr', url: `https://habr.com/ru/articles/${id}/`, title, author: `a${id}`, publishedAt: WEEKS[w]!.replace('12:00', '08:00'), hubs: [], tags: [], metrics: {}, seenIn: ['weekly'], warnings: [] });
      }
      const snapshot: ResearchSnapshot = { schemaVersion: RESEARCH_SNAPSHOT_SCHEMA_VERSION, platform: 'habr', collectedAt: WEEKS[w]!, status: 'live', windows: [], filters: { hubs: [], periods: ['weekly'] }, sampleSize: 40, sources: [], failures: [], articles, observations: [], saturatedAngles: [], limitations: [], momentumFormula: 'f' };
      const run = recordResearchRun(db, snapshot, { origin: 'live' });
      tagPlatformArticles(db, compileStoredTopics(loadTopics(db)), run.articleIds);
      recordTrendSnapshots(db, run.runId);
    });
    const analysis = analysisConfigSchema.parse({});
    const trend = trendFor(db, 'habr', 'ai-generic', analysis, { end: clock.now() });
    expect(trend.basis).toBe('research-runs');
    expect(trend.direction).toBe('rising');
    expect(trendFor(db, 'habr', 'databases', analysis, { end: clock.now() }).direction).toBe('declining');
    expect(trendFor(db, 'habr', 'ai-generic', analysis, { end: clock.now(), windowDays: 28 }).direction).toBe('insufficient-history');
  });
});
