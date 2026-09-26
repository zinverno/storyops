import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadConfig, parseConfig, resolveConfigFile, starterConfig } from '../src/config/load.js';
import { configDeprecations } from '../src/config/schema.js';
import { ROOT, tempDir } from './helpers.js';
import { initWorkspace } from '../src/workflow/init.js';

describe('configuration', () => {
  it('validates the example and the starter config', async () => {
    const { config: example, warnings } = await loadConfig(path.join(ROOT, 'examples/storyops.config.example.json'));
    expect(warnings).toEqual([]);
    expect(example.platforms.habr?.hubs).toEqual(['artificial_intelligence', 'programming', 'open_source']);
    expect(example.projects[0]!.glossary).toHaveLength(3);
    expect(example.topics[0]!.parent).toBe('ai-generic');
    expect(example.review.profile).toBe('engineering-story');
    expect(parseConfig(starterConfig()).author.profiles).toEqual({});
  });

  it('applies defaults and does not require any platform', () => {
    const c = parseConfig({ author: { name: 'A' } });
    expect(c.language).toBe('ru');
    expect(c.platforms).toEqual({});
    expect(c.research.requestDelayMs).toBe(2000);
    expect(c.analysis.windowDays).toBe(30);
    expect(c.analysis.saturation.minSample).toBe(15);
    expect(c.analysis.trends.windowDays).toBe(7);
    expect(c.paths.dataDir).toBe('.storyops');
    expect(c.review.maxAlternativeChars).toBe(240);
  });

  it('rejects invalid values with field paths', () => {
    expect(() => parseConfig({})).toThrow(/author/);
    expect(() => parseConfig({ author: { name: 'A' }, research: { requestDelayMs: 100 } })).toThrow(/research\.requestDelayMs/);
    expect(() => parseConfig({ author: { name: 'A', profiles: { habr: 'not a url' } } })).toThrow(/author\.profiles\.habr/);
    expect(() => parseConfig({ author: { name: 'A' }, platforms: { habr: { hubs: ['bad hub!'] } } })).toThrow(/hubs/);
    expect(() => parseConfig({ author: { name: 'A' }, analysis: { saturation: { crowdedShare: 2 } } })).toThrow(/analysis\.saturation\.crowdedShare/);
  });

  it('accepts a v2 (editorial-kit) config and warns about generation-only fields without breaking', async () => {
    const legacy = { schemaVersion: 1, author: { name: 'A' }, editorial: { defaultStyle: 'engineering-story' }, screenshots: { outputDir: 'images' }, paths: { editorialDir: '.editorial', articlesDir: 'articles' } };
    expect(() => parseConfig(legacy)).not.toThrow();
    const warnings = configDeprecations(legacy);
    expect(warnings.join('\n')).toMatch(/"editorial".*deprecated and ignored/);
    expect(warnings.join('\n')).toMatch(/paths\.articlesDir/);
    expect(warnings.join('\n')).toMatch(/"screenshots" is deprecated and ignored/);
    expect(warnings.join('\n')).toMatch(/storyops migrate/);
    const tmp = await tempDir();
    try {
      await writeFile(path.join(tmp.dir, 'editorial.config.json'), JSON.stringify(legacy));
      expect(resolveConfigFile(tmp.dir)).toEqual({ file: path.join(tmp.dir, 'editorial.config.json'), legacy: true });
      const loaded = await loadConfig(resolveConfigFile(tmp.dir).file);
      expect(loaded.warnings.some((w) => w.includes('legacy editorial.config.json'))).toBe(true);
    } finally {
      await tmp.cleanup();
    }
  });

  it('init creates the workspace and database, never hardcodes an author and adds .gitignore entries', async () => {
    const tmp = await tempDir();
    try {
      const r = await initWorkspace(tmp.dir, { authorName: 'Тест' });
      expect(r.created.some((f) => f.endsWith('storyops.config.json'))).toBe(true);
      const cfg = JSON.parse(await readFile(path.join(tmp.dir, 'storyops.config.json'), 'utf8'));
      expect(cfg.author).toMatchObject({ name: 'Тест', profiles: {} });
      expect(existsSync(path.join(tmp.dir, '.storyops', 'storyops.db'))).toBe(true);
      expect(existsSync(path.join(tmp.dir, 'topics'))).toBe(true);
      expect(existsSync(path.join(tmp.dir, 'reviews'))).toBe(true);
      expect(existsSync(path.join(tmp.dir, 'articles'))).toBe(false);
      expect(await readFile(path.join(tmp.dir, '.gitignore'), 'utf8')).toMatch(/\.env\n[\s\S]*\.storyops\/cache\//);
      const again = await initWorkspace(tmp.dir);
      expect(again.skipped).toHaveLength(1);
    } finally {
      await tmp.cleanup();
    }
  });
});
