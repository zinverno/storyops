import path from 'node:path';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { ROOT, tempDir } from './helpers.js';

const run = promisify(execFile);
const CLI = path.join(ROOT, 'dist/src/cli/index.js');

// Runs against the compiled CLI; `npm run check` builds before testing.
if (!existsSync(CLI) && process.env.EDITORIAL_REQUIRE_BUILD === '1') throw new Error('EDITORIAL_REQUIRE_BUILD=1 but dist/ is missing; run `npm run build` first.');
describe.skipIf(!existsSync(CLI))('editorial-kit CLI (built)', () => {
  it('prints help and platform support', async () => {
    const help = await run('node', [CLI, '--help']);
    expect(help.stdout).toMatch(/repurpose/);
    const platforms = await run('node', [CLI, 'platforms', 'list']);
    expect(platforms.stdout).toMatch(/habr\s+strategy 1\.0\.0\s+live research: implemented/);
    expect(platforms.stdout).toMatch(/linkedin\s+strategy 1\.0\.0\s+live research: unsupported/);
  });

  it('runs init, reports a clear error for missing config, and validates skills', async () => {
    const tmp = await tempDir();
    try {
      const failure = await run('node', [CLI, '-C', tmp.dir, 'gap']).catch((e: { stderr: string; code: number }) => e);
      expect((failure as { stderr: string }).stderr).toMatch(/Configuration file not found[\s\S]*hint: Run `editorial-kit init`/);
      const init = await run('node', [CLI, '-C', tmp.dir, '--json', 'init', '--author', 'Test']);
      expect(JSON.parse(init.stdout).created.length).toBeGreaterThan(0);
      const skills = await run('node', [CLI, 'skills', 'validate']);
      expect(skills.stdout).toMatch(/✓ editorial-author/);
    } finally {
      await tmp.cleanup();
    }
  });
});
