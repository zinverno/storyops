import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDefaultRegistry, PlatformRegistry } from '../platforms/registry.js';
import { platformStrategySchema, type PlatformModule } from '../platforms/schema.js';
import { genericBlogStrategy } from '../platforms/generic-blog/strategy.js';
import { runDemo } from '../src/demo/run.js';
import { parseFrontmatter } from '../src/shared/frontmatter.js';
import { loadContext } from '../src/workflow/context.js';
import { repurposeWorkflow } from '../src/workflow/story.js';
import { researchWorkflow } from '../src/workflow/research.js';
import { silentLogger } from '../src/shared/logger.js';
import { clock, tempDir } from './helpers.js';

describe('platform strategies', () => {
  it('every registered strategy validates against the shared schema', () => {
    const registry = createDefaultRegistry();
    expect(registry.ids()).toEqual(['generic-blog', 'habr', 'linkedin', 'medium', 'telegram']);
    for (const module of registry.list()) {
      expect(platformStrategySchema.safeParse(module.strategy).success).toBe(true);
      const s = module.strategy;
      expect(s.content.supportedPublicationTypes).toContain(s.content.defaultPublicationType);
      expect(s.structures[s.content.defaultPublicationType]?.length).toBeGreaterThan(0);
    }
  });

  it('only Habr claims live research; the others say so explicitly', () => {
    const registry = createDefaultRegistry();
    expect(registry.list().filter((m) => m.strategy.research.liveResearch === 'implemented').map((m) => m.strategy.id)).toEqual(['habr']);
    for (const id of ['medium', 'linkedin', 'telegram']) {
      expect(registry.get(id).research).toBeUndefined();
      expect(registry.get(id).strategy.research.liveResearch).toBe('unsupported');
    }
  });

  it('distinguishes hard constraints from recommendations', () => {
    const telegram = createDefaultRegistry().get('telegram').strategy;
    const constraints = telegram.formatting.constraints.filter((r) => r.kind === 'constraint');
    expect(constraints.map((c) => c.text).join(' ')).toMatch(/4096/);
    expect(constraints.every((c) => c.source)).toBe(true);
  });

  it('rejects invalid and duplicate registrations', () => {
    const registry = new PlatformRegistry();
    expect(() => registry.register({ strategy: { ...genericBlogStrategy, id: 'Bad Id' } })).toThrow(/failed validation/);
    registry.register({ strategy: genericBlogStrategy });
    expect(() => registry.register({ strategy: genericBlogStrategy })).toThrow(/already registered/);
    expect(() => registry.get('nope')).toThrow(/Unknown platform/);
  });
});

describe('adding a platform requires no core changes', () => {
  let tmp: Awaited<ReturnType<typeof tempDir>>;
  beforeAll(async () => {
    tmp = await tempDir();
    await runDemo(tmp.dir);
  }, 120_000);
  afterAll(async () => tmp.cleanup());

  it('registers a new strategy at runtime and repurposes the same canonical story with it', async () => {
    const devto: PlatformModule = {
      strategy: {
        ...genericBlogStrategy,
        id: 'devto-test',
        displayName: 'Test community platform',
        research: { liveResearch: 'unsupported', authorHistory: 'manual-import', sources: [], limitations: ['test platform'] },
      },
      renderer: { render: ({ story, strategy }) => `---\nplatform: ${strategy.id}\nstory: ${story.slug}\nstatus: scaffold\n---\n\n# ${story.topic}\n` },
    };
    const registry = createDefaultRegistry().register(devto);
    const ctx = await loadContext({ root: tmp.dir, registry, clock, logger: silentLogger });
    const storyFile = path.join(tmp.dir, 'articles/notegarden-health-model/story.json');
    const { output, brief } = await repurposeWorkflow(ctx, storyFile, 'devto-test');
    const doc = parseFrontmatter(await readFile(output, 'utf8'));
    expect(doc.data).toMatchObject({ platform: 'devto-test', story: 'notegarden-health-model' });
    expect(brief.platformContext.status).toBe('live research unsupported');
    const research = await researchWorkflow(ctx, 'devto-test');
    expect(research.snapshot.status).toBe('unsupported');
    expect(research.snapshot.limitations).toContain('live research unsupported');
    const story = JSON.parse(await readFile(storyFile, 'utf8')) as { outputs: Array<{ platform: string }> };
    expect(story.outputs.map((o) => o.platform)).toContain('devto-test');
  });

  it('refuses to overwrite a draft that is no longer a scaffold', async () => {
    const ctx = await loadContext({ root: tmp.dir, clock, logger: silentLogger });
    const storyFile = path.join(tmp.dir, 'articles/notegarden-health-model/story.json');
    const out = path.join(tmp.dir, 'articles/notegarden-health-model/outputs/habr.md');
    const { writeFile } = await import('node:fs/promises');
    await writeFile(out, '---\nstatus: draft\n---\n\nReal text\n');
    await expect(repurposeWorkflow(ctx, storyFile, 'habr')).rejects.toThrow(/refusing to overwrite/);
  });
});
