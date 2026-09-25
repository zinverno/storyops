import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { StoryOpsError } from '../shared/errors.js';
import { pathExists } from '../shared/fs.js';

const run = promisify(execFile);

const historySchema = z.object({
  author: z.object({ name: z.string(), email: z.string() }),
  commits: z.array(
    z.object({
      date: z.string(),
      message: z.string(),
      write: z.record(z.string(), z.string()).optional(),
      delete: z.array(z.string()).optional(),
      rename: z.array(z.tuple([z.string(), z.string()])).optional(),
      tag: z.string().optional(),
    }),
  ),
});

/**
 * Replays a scripted history (fixtures/projects/<name>/history.json) into a
 * real git repository with fixed author/committer dates. Only used for the
 * fixture scenario and tests; it writes only inside `target`.
 */
export async function buildFixtureRepo(historyFile: string, target: string): Promise<void> {
  const history = historySchema.parse(JSON.parse(await readFile(historyFile, 'utf8')));
  if (pathExists(target)) await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });
  const baseEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: history.author.name,
    GIT_AUTHOR_EMAIL: history.author.email,
    GIT_COMMITTER_NAME: history.author.name,
    GIT_COMMITTER_EMAIL: history.author.email,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
  };
  const git = (args: string[], env: NodeJS.ProcessEnv = baseEnv) => run('git', args, { cwd: target, env });
  try {
    await git(['init', '-q', '-b', 'main']);
  } catch {
    await git(['init', '-q']);
    await git(['checkout', '-q', '-b', 'main']);
  }
  await git(['config', 'commit.gpgsign', 'false']);
  await git(['config', 'tag.gpgsign', 'false']);
  for (const c of history.commits) {
    for (const [file, content] of Object.entries(c.write ?? {})) {
      const abs = path.join(target, file);
      await mkdir(path.dirname(abs), { recursive: true });
      await writeFile(abs, content, 'utf8');
    }
    for (const [from, to] of c.rename ?? []) {
      await mkdir(path.dirname(path.join(target, to)), { recursive: true });
      await rename(path.join(target, from), path.join(target, to));
    }
    for (const file of c.delete ?? []) await rm(path.join(target, file), { force: true });
    await git(['add', '-A']);
    const env = { ...baseEnv, GIT_AUTHOR_DATE: c.date, GIT_COMMITTER_DATE: c.date };
    try {
      await git(['commit', '-q', '--no-verify', '-m', c.message], env);
    } catch (error) {
      throw new StoryOpsError('FIXTURE_REPO', `Could not replay commit "${c.message}"`, { cause: error });
    }
    if (c.tag) await git(['tag', c.tag], env);
  }
}
