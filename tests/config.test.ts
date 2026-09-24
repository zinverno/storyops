import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { loadConfig, parseConfig, starterConfig } from '../src/config/load.js';
import { ROOT, tempDir } from './helpers.js';
import { initWorkspace } from '../src/workflow/init.js';

describe('configuration', () => {
  it('validates the example and the starter config', async () => {
    const example = await loadConfig(path.join(ROOT, 'examples/editorial.config.example.json'));
    expect(example.platforms.habr?.hubs).toEqual(['artificial_intelligence', 'programming', 'open_source']);
    expect(example.projects[0]!.glossary).toHaveLength(2);
    expect(parseConfig(starterConfig()).author.profiles).toEqual({});
  });

  it('applies defaults and does not require any platform', () => {
    const c = parseConfig({ author: { name: 'A' } });
    expect(c.language).toBe('ru');
    expect(c.platforms).toEqual({});
    expect(c.research.requestDelayMs).toBe(2000);
    expect(c.screenshots.viewport).toEqual({ width: 1440, height: 1000 });
  });

  it('rejects invalid values with field paths', () => {
    expect(() => parseConfig({})).toThrow(/author/);
    expect(() => parseConfig({ author: { name: 'A' }, research: { requestDelayMs: 100 } })).toThrow(/research\.requestDelayMs/);
    expect(() => parseConfig({ author: { name: 'A', profiles: { habr: 'not a url' } } })).toThrow(/author\.profiles\.habr/);
    expect(() => parseConfig({ author: { name: 'A' }, platforms: { habr: { hubs: ['bad hub!'] } } })).toThrow(/hubs/);
  });

  it('init creates the workspace, never hardcodes an author and adds .gitignore entries', async () => {
    const tmp = await tempDir();
    try {
      const r = await initWorkspace(tmp.dir, { authorName: 'Тест' });
      expect(r.created.some((f) => f.endsWith('editorial.config.json'))).toBe(true);
      const cfg = JSON.parse(await readFile(path.join(tmp.dir, 'editorial.config.json'), 'utf8'));
      expect(cfg.author).toMatchObject({ name: 'Тест', profiles: {} });
      expect(await readFile(path.join(tmp.dir, '.gitignore'), 'utf8')).toMatch(/\.env\n[\s\S]*\.editorial\/cache\//);
      const again = await initWorkspace(tmp.dir);
      expect(again.skipped).toHaveLength(1);
    } finally {
      await tmp.cleanup();
    }
  });
});
