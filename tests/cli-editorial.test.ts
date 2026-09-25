import path from 'node:path';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { ROOT, tempDir } from './helpers.js';

const run = promisify(execFile);
const CLI = path.join(ROOT, 'dist/src/cli/index.js');
type Failure = { stdout: string; stderr: string; code: number };
const fail = (p: Promise<unknown>) => p.then(() => { throw new Error('expected a non-zero exit'); }, (e: Failure) => e);

if (!existsSync(CLI) && process.env.EDITORIAL_REQUIRE_BUILD === '1') throw new Error('EDITORIAL_REQUIRE_BUILD=1 but dist/ is missing; run `npm run build` first.');
describe.skipIf(!existsSync(CLI))('editorial-kit CLI: editorial layer (built)', () => {
  it('lists, shows and validates style presets', async () => {
    const list = await run('node', [CLI, 'styles', 'list']);
    expect(list.stdout.trim().split('\n')).toHaveLength(8);
    expect(list.stdout).toMatch(/engineering-story\s+1\.0\.0\s+built-in\s+Engineering story/);
    expect((await run('node', [CLI, 'styles', 'show', 'dev-diary'])).stdout).toMatch(/narrative mode: chronological/);
    expect((await run('node', [CLI, 'styles', 'validate'])).stdout).toMatch(/8 valid style\(s\)/);
    expect((await fail(run('node', [CLI, 'styles', 'show', 'nope']))).stderr).toMatch(/Unknown article style "nope"/);
  });

  it('runs input → plan → validate → audit in a fresh workspace', async () => {
    const tmp = await tempDir();
    try {
      const cli = (...args: string[]) => run('node', [CLI, '-C', tmp.dir, ...args], { cwd: tmp.dir });
      await cli('init', '--author', 'Test');
      const config = JSON.parse(await readFile(path.join(tmp.dir, 'editorial.config.json'), 'utf8')) as Record<string, unknown>;
      await writeFile(path.join(tmp.dir, 'editorial.config.json'), JSON.stringify({ ...config, projects: [{ id: 'notegarden', name: 'Notegarden', path: './notegarden' }] }));
      const dir = path.join(tmp.dir, 'articles', 'notegarden-health-model');
      await mkdir(dir, { recursive: true });
      await copyFile(path.join(ROOT, 'examples/canonical-story.example.json'), path.join(dir, 'story.json'));
      const story = 'articles/notegarden-health-model/story.json';

      expect((await cli('input', 'init', '--story', story)).stdout).toMatch(/Author input: .*author-input\.md/);
      await cli('input', 'add', '--story', story, '--priority', 'verbatim', '--text', '"Finding перестал быть просто строкой в отчёте."');
      await cli('input', 'add', '--story', story, '--priority', 'avoid', '--text', 'революционный');
      const shown = JSON.parse((await cli('--json', 'input', 'show', '--story', story)).stdout) as { items: Array<{ priority: string; text: string }> };
      expect(shown.items.map((i) => [i.priority, i.text])).toEqual([
        ['verbatim', 'Finding перестал быть просто строкой в отчёте.'],
        ['avoid', 'революционный'],
      ]);
      expect((await fail(cli('input', 'add', '--story', story, '--priority', 'urgent', '--text', 'x'))).stderr).toMatch(/Allowed choices are verbatim, must, should, may, background, avoid/);

      const noStyle = await cli('editorial', 'plan', '--story', story, '--platform', 'habr');
      expect(noStyle.stdout).toMatch(/Style: NOT SELECTED\. Candidates for engineering-story: engineering-story/);
      expect(noStyle.stdout).toMatch(/no research snapshot/);
      const planned = await cli('editorial', 'plan', '--story', story, '--platform', 'habr', '--style', 'engineering-story');
      expect(planned.stdout).toMatch(/Editorial plan \(refreshed\)/);
      expect(existsSync(path.join(dir, 'editorial', 'voice-plan.md'))).toBe(true);

      const invalid = await fail(cli('editorial', 'validate', '--story', story, '--platform', 'habr'));
      expect(invalid.code).toBe(1);
      expect(invalid.stdout).toMatch(/NOT ready for drafting/);
      expect(invalid.stdout).toMatch(/Unresolved fields: readerPromise/);

      await mkdir(path.join(dir, 'outputs'), { recursive: true });
      await writeFile(path.join(dir, 'outputs', 'habr.md'), '# Черновик\n\nFinding перестал быть просто строкой в отчёте. Это не революционный шаг.\n');
      const audit = await fail(cli('editorial', 'audit', '--story', story, '--platform', 'habr'));
      expect(audit.code).toBe(1);
      expect(audit.stdout).toMatch(/VERBATIM {3}1\/1 incorporated exactly/);
      expect(audit.stdout).toMatch(/DO NOT USE 1 violation\(s\)/);
      expect(existsSync(path.join(dir, 'editorial', 'audit.md'))).toBe(true);
    } finally {
      await tmp.cleanup();
    }
  });
});
