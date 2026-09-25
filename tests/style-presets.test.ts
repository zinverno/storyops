import path from 'node:path';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import YAML from 'yaml';
import { expectsFirstPerson, loadStyleCatalog, parseStylePreset } from '../src/editorial/styles.js';
import { tempDir } from './helpers.js';
import { STYLES_DIR } from './editorial-helpers.js';

const BUILT_IN = ['architecture-deep-dive', 'dev-diary', 'engineering-story', 'postmortem', 'product-story', 'release-retrospective', 'technical-essay', 'tutorial'];

describe('article style presets', () => {
  it('all built-in presets validate', async () => {
    const catalog = await loadStyleCatalog({ builtInDir: STYLES_DIR });
    expect(catalog.issues).toEqual([]);
    expect(catalog.ids()).toEqual(BUILT_IN);
    for (const s of catalog.list()) {
      expect(s.source).toBe('built-in');
      expect(s.hash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('encodes real differences between presets', async () => {
    const catalog = await loadStyleCatalog({ builtInDir: STYLES_DIR });
    const story = catalog.get('engineering-story').preset;
    const deep = catalog.get('architecture-deep-dive').preset;
    const diary = catalog.get('dev-diary').preset;
    expect(story.perspective).toBe('first-person');
    expect(story.narrativeMode).toBe('problem-driven');
    expect(deep.narrativeMode).toBe('architecture-first');
    expect(deep.visualUsage).toBe('central');
    expect(deep.personalPresence).toBe('low');
    expect(diary.narrativeMode).toBe('chronological');
    expect(diary.personalPresence).toBe('high');
    expect(expectsFirstPerson(story)).toBe(true);
    expect(catalog.suitableFor('postmortem').map((s) => s.preset.id)).toContain('postmortem');
  });

  it('looks styles up and explains unknown ids', async () => {
    const catalog = await loadStyleCatalog({ builtInDir: STYLES_DIR });
    expect(catalog.get('tutorial').preset.displayName).toBe('Tutorial');
    expect(() => catalog.get('viral-listicle')).toThrow(/Unknown article style "viral-listicle"/);
  });

  it('rejects an invalid preset with field-level messages', () => {
    const r = parseStylePreset('schemaVersion: 1\nid: broken\nversion: 1.0.0\nperspective: omniscient\n', '/x/broken.yaml');
    expect(r.style).toBeUndefined();
    const messages = r.issues.map((i) => i.message).join('\n');
    expect(messages).toMatch(/perspective/);
    expect(messages).toMatch(/displayName/);
    expect(parseStylePreset('schemaVersion: 1\nid: [\n', '/x/y.yaml').issues[0]!.message).toMatch(/not valid YAML/);
  });

  it('rejects unknown fields and a file name that does not match the id', async () => {
    const src = await readFile(path.join(STYLES_DIR, 'tutorial.yaml'), 'utf8');
    expect(parseStylePreset(`${src}\ntone: loud\n`, '/x/tutorial.yaml').issues[0]!.message).toMatch(/tone|Unrecognized/i);
    expect(parseStylePreset(src, '/x/other-name.yaml').issues[0]!.message).toMatch(/must match the file name "other-name"/);
  });

  it('loads a custom workspace preset without code changes, and rejects duplicate ids', async () => {
    const tmp = await tempDir();
    try {
      const dir = path.join(tmp.dir, '.editorial', 'styles');
      await mkdir(dir, { recursive: true });
      const custom = YAML.parse(await readFile(path.join(STYLES_DIR, 'dev-diary.yaml'), 'utf8')) as Record<string, unknown>;
      await writeFile(path.join(dir, 'weekly-log.yaml'), YAML.stringify({ ...custom, id: 'weekly-log', displayName: 'Weekly log', humorLevel: 'none' }));
      await copyFile(path.join(STYLES_DIR, 'postmortem.yaml'), path.join(dir, 'postmortem.yaml'));
      const catalog = await loadStyleCatalog({ builtInDir: STYLES_DIR, workspaceDir: dir });
      expect(catalog.get('weekly-log').source).toBe('workspace');
      expect(catalog.get('weekly-log').preset.humorLevel).toBe('none');
      expect(catalog.get('postmortem').source).toBe('built-in');
      expect(catalog.issues).toHaveLength(1);
      expect(catalog.issues[0]!.message).toMatch(/duplicate style id "postmortem"/);
    } finally {
      await tmp.cleanup();
    }
  });
});
