import path from 'node:path';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { ROOT, tempDir } from './helpers.js';

const run = promisify(execFile);
const CLI = path.join(ROOT, 'dist/src/cli/index.js');
type Failure = { stderr: string; stdout: string; code: number };

// Runs against the compiled CLI; `npm run check` builds before testing.
if (!existsSync(CLI) && process.env.EDITORIAL_REQUIRE_BUILD === '1') throw new Error('EDITORIAL_REQUIRE_BUILD=1 but dist/ is missing; run `npm run build` first.');
describe.skipIf(!existsSync(CLI))('storyops CLI (built)', () => {
  it('prints the v3 command tree and platform support', async () => {
    const help = await run('node', [CLI, '--help']);
    for (const cmd of ['research', 'trends', 'saturation', 'patterns', 'author', 'repo', 'topics', 'review', 'findings', 'db', 'migrate', 'doctor']) expect(help.stdout).toMatch(new RegExp(`\\n  ${cmd}\\b`));
    expect(help.stdout).toMatch(/StoryOps analyses\. The human writes\./);
    for (const removed of ['repurpose', 'brief', 'story', 'editorial', 'create', 'screenshots']) expect(help.stdout).not.toMatch(new RegExp(`\\n  ${removed}\\b`));
    const platforms = await run('node', [CLI, 'platforms', 'list']);
    expect(platforms.stdout).toMatch(/habr\s+strategy 2\.0\.0\s+live research: implemented/);
    expect(platforms.stdout).toMatch(/linkedin\s+strategy 2\.0\.0\s+live research: unsupported/);
  });

  it('runs init, reports a clear error for missing config, and validates skills and profiles', async () => {
    const tmp = await tempDir();
    try {
      const failure = (await run('node', [CLI, '-C', tmp.dir, 'trends']).catch((e: Failure) => e)) as Failure;
      expect(failure.stderr).toMatch(/Configuration file not found[\s\S]*hint: Run `storyops init`/);
      const init = await run('node', [CLI, '-C', tmp.dir, '--json', 'init', '--author', 'Test']);
      expect(JSON.parse(init.stdout).created.length).toBeGreaterThan(0);
      const status = await run('node', [CLI, '-C', tmp.dir, 'db', 'status']);
      expect(status.stdout).toMatch(/schema v5 of v5/);
      const skills = await run('node', [CLI, 'skills', 'validate']);
      expect(skills.stdout).toMatch(/✓ storyops-review/);
      const profiles = await run('node', [CLI, 'profiles', 'validate']);
      expect(profiles.stdout).toMatch(/valid profile\(s\): .*engineering-story/);
    } finally {
      await tmp.cleanup();
    }
  });

  it('removed generation commands warn and do nothing', async () => {
    const tmp = await tempDir();
    try {
      for (const args of [['repurpose', 'story.json', '-p', 'habr'], ['create', '-t', 'x', '-p', 'habr'], ['brief', '-s', 'story.json', '-p', 'habr'], ['story', 'create', '-t', 'x'], ['editorial', 'plan']]) {
        const r = (await run('node', [CLI, '-C', tmp.dir, ...args]).catch((e: Failure) => e)) as Failure;
        expect(r.code, args.join(' ')).toBe(2);
        expect(r.stderr, args.join(' ')).toMatch(/deprecated and was removed: StoryOps no longer generates publication drafts/);
      }
      // Screenshot capture produced publication assets; it is not reachable any more.
      for (const args of [['screenshots', 'capture', '--plan', 'plan.json'], ['screenshots', 'plan', '-s', 'story.json'], ['screenshots']]) {
        const r = (await run('node', [CLI, '-C', tmp.dir, ...args]).catch((e: Failure) => e)) as Failure;
        expect(r.code, args.join(' ')).toBe(2);
        expect(r.stderr, args.join(' ')).toMatch(/deprecated and was removed: StoryOps is analysis-only and no longer creates publication assets/);
      }
      const { readdir } = await import('node:fs/promises');
      expect(await readdir(tmp.dir)).toEqual([]);
    } finally {
      await tmp.cleanup();
    }
  });

  it('keeps v2 analysis commands as deprecated aliases', async () => {
    const tmp = await tempDir();
    try {
      await run('node', [CLI, '-C', tmp.dir, 'init', '--author', 'Test']);
      const legacy = (await run('node', [CLI, '-C', tmp.dir, 'research', '-p', 'medium']).catch((e: Failure) => e)) as Failure;
      expect(legacy.stderr).toMatch(/DEPRECATED: `research -p <platform>` → use `storyops research platform <platform>`/);
      expect(legacy.stdout).toMatch(/live research is unsupported|Live research is unsupported/i);
    } finally {
      await tmp.cleanup();
    }
  });

  it('reviews a file outside any workspace without touching it', async () => {
    const tmp = await tempDir();
    try {
      const { writeFile, readFile } = await import('node:fs/promises');
      const article = path.join(tmp.dir, 'note.md');
      const text = '# Заметка\n\nДанная система позволяет осуществлять анализ заметок.\n';
      await writeFile(article, text);
      const r = await run('node', [CLI, '-C', tmp.dir, '--json', 'review', article]);
      const out = JSON.parse(r.stdout) as { articleUnchanged: boolean; report: { findings: Array<{ rule: string; alternative?: string }> } };
      expect(out.articleUnchanged).toBe(true);
      expect(out.report.findings.find((f) => f.rule === 'bureaucratic-enable')?.alternative).toBe('Система анализирует');
      expect(await readFile(article, 'utf8')).toBe(text);
    } finally {
      await tmp.cleanup();
    }
  });
});
