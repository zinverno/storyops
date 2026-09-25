import path from 'node:path';
import { appendFile, readFile } from 'node:fs/promises';
import { DEFAULT_CONFIG_FILE, starterConfig } from '../config/load.js';
import { openDatabase } from '../db/database.js';
import { ensureDir, pathExists, writeJson, writeText } from '../shared/fs.js';
import { resolveWorkspace } from '../shared/workspace.js';

export const RECOMMENDED_GITIGNORE = ['.env', '.env.*', '!.env.example', '.storyops/cache/', '.storyops/backups/'];

export interface InitResult {
  created: string[];
  updated: string[];
  skipped: string[];
}

/** Creates storyops.config.json, the .storyops/ data directory with its database, topics/ and reviews/. */
export async function initWorkspace(root: string, options: { force?: boolean; authorName?: string; habrProfile?: string } = {}): Promise<InitResult> {
  const workspace = resolveWorkspace(root, { configFile: DEFAULT_CONFIG_FILE });
  const result: InitResult = { created: [], updated: [], skipped: [] };
  if (pathExists(workspace.configFile) && !options.force) result.skipped.push(workspace.configFile);
  else {
    const config = starterConfig() as { author: { name: string; profiles: Record<string, string> } };
    if (options.authorName) config.author.name = options.authorName;
    if (options.habrProfile) config.author.profiles.habr = options.habrProfile;
    await writeJson(workspace.configFile, config);
    result.created.push(workspace.configFile);
  }
  for (const dir of [workspace.researchDir, workspace.authorDir, workspace.reposDir, workspace.reportsDir, workspace.topicsDir, workspace.reviewsDir]) {
    if (!pathExists(dir)) {
      await ensureDir(dir);
      result.created.push(dir);
    }
  }
  if (!pathExists(workspace.dbFile)) {
    const { db } = await openDatabase(workspace.dbFile, { backupDir: workspace.backupsDir });
    db.close();
    result.created.push(workspace.dbFile);
  }
  const gitignore = path.join(workspace.root, '.gitignore');
  if (!pathExists(gitignore)) {
    await writeText(gitignore, `# storyops\n${RECOMMENDED_GITIGNORE.join('\n')}\n`);
    result.created.push(gitignore);
  } else {
    const lines = (await readFile(gitignore, 'utf8')).split(/\r?\n/).map((l) => l.trim());
    const missing = RECOMMENDED_GITIGNORE.filter((l) => !lines.includes(l));
    if (missing.length) {
      await appendFile(gitignore, `\n# storyops\n${missing.join('\n')}\n`);
      result.updated.push(gitignore);
    }
  }
  return result;
}
