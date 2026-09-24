import path from 'node:path';
import { appendFile, readFile } from 'node:fs/promises';
import { starterConfig } from '../config/load.js';
import { ensureDir, pathExists, writeJson, writeText } from '../shared/fs.js';
import { resolveWorkspace } from '../shared/workspace.js';

export const RECOMMENDED_GITIGNORE = ['.env', '.env.*', '!.env.example', '.editorial/cache/', '.editorial/tmp/'];

export interface InitResult {
  created: string[];
  updated: string[];
  skipped: string[];
}

export async function initWorkspace(root: string, options: { force?: boolean; authorName?: string; habrProfile?: string } = {}): Promise<InitResult> {
  const workspace = resolveWorkspace(root);
  const result: InitResult = { created: [], updated: [], skipped: [] };
  if (pathExists(workspace.configFile) && !options.force) result.skipped.push(workspace.configFile);
  else {
    const config = starterConfig() as { author: { name: string; profiles: Record<string, string> } };
    if (options.authorName) config.author.name = options.authorName;
    if (options.habrProfile) config.author.profiles.habr = options.habrProfile;
    await writeJson(workspace.configFile, config);
    result.created.push(workspace.configFile);
  }
  for (const dir of [workspace.publicationsDir, workspace.researchDir, path.dirname(workspace.storiesIndex), workspace.projectsDir, workspace.articlesDir]) {
    if (!pathExists(dir)) {
      await ensureDir(dir);
      result.created.push(dir);
    }
  }
  const gitignore = path.join(workspace.root, '.gitignore');
  if (!pathExists(gitignore)) {
    await writeText(gitignore, `# editorial-kit\n${RECOMMENDED_GITIGNORE.join('\n')}\n`);
    result.created.push(gitignore);
  } else {
    const lines = (await readFile(gitignore, 'utf8')).split(/\r?\n/).map((l) => l.trim());
    const missing = RECOMMENDED_GITIGNORE.filter((l) => !lines.includes(l));
    if (missing.length) {
      await appendFile(gitignore, `\n# editorial-kit\n${missing.join('\n')}\n`);
      result.updated.push(gitignore);
    }
  }
  return result;
}
