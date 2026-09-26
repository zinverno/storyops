import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { createDefaultRegistry, PlatformRegistry } from '../platforms/registry.js';
import { PLATFORM_STRATEGY_SCHEMA_VERSION, platformStrategySchema, type PlatformModule } from '../platforms/schema.js';
import { genericBlogStrategy } from '../platforms/generic-blog/strategy.js';
import { parseConfig } from '../src/config/load.js';
import { silentLogger } from '../src/shared/logger.js';
import { workspaceFor, type AppContext } from '../src/workflow/context.js';
import { importDatasetWorkflow, researchPlatformWorkflow, trendsWorkflow } from '../src/workflow/research.js';
import { clock, tempDir } from './helpers.js';

describe('platform strategies (analysis and review fit)', () => {
  it('every registered strategy validates against the v2 schema', () => {
    const registry = createDefaultRegistry();
    expect(registry.ids()).toEqual(['generic-blog', 'habr', 'linkedin', 'medium', 'telegram']);
    for (const m of registry.list()) {
      expect(platformStrategySchema.safeParse(m.strategy).success).toBe(true);
      expect(m.strategy.schemaVersion).toBe(PLATFORM_STRATEGY_SCHEMA_VERSION);
      // Generation-oriented v1 fields are gone.
      for (const legacy of ['structures', 'opening', 'headline', 'content', 'tone']) expect(m.strategy).not.toHaveProperty(legacy);
      expect(m).not.toHaveProperty('renderer');
    }
  });

  it('only Habr claims live research; the others are analysis-only and accept imports', () => {
    const registry = createDefaultRegistry();
    expect(registry.get('habr').strategy.research.liveResearch).toBe('implemented');
    expect(registry.get('habr').research?.collectTrends).toBeDefined();
    for (const id of ['medium', 'linkedin', 'telegram']) {
      const s = registry.get(id).strategy;
      expect(s.research.liveResearch).toBe('unsupported');
      expect(s.research.importSupported).toBe(true);
      expect(registry.get(id).research).toBeUndefined();
    }
  });

  it('distinguishes hard constraints from context', () => {
    const telegram = createDefaultRegistry().get('telegram').strategy;
    expect(telegram.formatting.constraints.filter((r) => r.kind === 'constraint').map((r) => r.text).join(' ')).toMatch(/4096/);
    expect(telegram.reviewContext.sections).toBe('not-rendered');
  });

  it('rejects invalid and duplicate registrations', () => {
    const registry = new PlatformRegistry().register({ strategy: genericBlogStrategy });
    expect(() => registry.register({ strategy: genericBlogStrategy })).toThrow(/already registered/);
    expect(() => registry.register({ strategy: { ...genericBlogStrategy, id: 'Bad Id' } })).toThrow(/validation/);
  });

  it('a platform registered at runtime works with research import and trends, without core changes', async () => {
    const tmp = await tempDir();
    try {
      const devto: PlatformModule = { strategy: { ...genericBlogStrategy, id: 'devto', displayName: 'DEV Community', research: { ...genericBlogStrategy.research, liveResearch: 'unsupported' } } };
      const registry = createDefaultRegistry().register(devto);
      const config = parseConfig({ author: { name: 'A' }, research: { defaultPlatform: 'devto' } });
      const ctx: AppContext = { workspace: workspaceFor(tmp.dir, config, path.join(tmp.dir, 'storyops.config.json')), config, configWarnings: [], registry, clock, logger: silentLogger };
      const live = await researchPlatformWorkflow(ctx, 'devto');
      expect(live.snapshot.status).toBe('unsupported');
      const dataset = { schemaVersion: 1, platform: 'devto', collectedAt: '2026-09-20T12:00:00Z', articles: Array.from({ length: 20 }, (_, i) => ({ id: `devto:${i}`, url: `https://dev.to/x/${i}`, title: i < 8 ? `Building AI agents, part ${i}` : `Rust tips ${i}`, author: `a${i}`, publishedAt: '2026-09-18T10:00:00Z' })) };
      const file = path.join(tmp.dir, 'devto.json');
      await writeFile(file, JSON.stringify(dataset));
      const imported = await importDatasetWorkflow(ctx, file);
      expect(imported.run).toMatchObject({ newArticles: 20, duplicate: false });
      expect((await importDatasetWorkflow(ctx, file)).run.duplicate).toBe(true);
      const trends = await trendsWorkflow(ctx, { platform: 'devto' });
      expect(trends.rows.find((r) => r.topicId === 'ai-agents')?.saturation.metrics.articleCount).toBe(8);
      ctx.database?.close();
    } finally {
      await tmp.cleanup();
    }
  });
});
