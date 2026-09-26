import path from 'node:path';
import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createDefaultRegistry } from '../../platforms/registry.js';
import { LEGACY_CONFIG_FILE, loadConfig, resolveConfigFile } from '../config/load.js';
import type { StoryOpsConfig } from '../config/schema.js';
import { openDatabase } from '../db/database.js';
import { loadMigrations } from '../db/migrate.js';
import { gitAvailable } from '../git/git.js';
import { loadProfileCatalog } from '../review/profiles.js';
import { errorMessage } from '../shared/errors.js';
import { pathExists } from '../shared/fs.js';
import { validateSkillsDir } from '../skills/validate.js';
import { packageRoot } from '../demo/paths.js';
import { workspaceFor } from './context.js';
import { resolveWorkspace } from '../shared/workspace.js';

export interface DoctorCheck {
  name: string;
  status: 'ok' | 'warn' | 'fail';
  message: string;
  hint?: string;
}

export interface DoctorOptions {
  root: string;
  configFile?: string;
}

function check(name: string, status: DoctorCheck['status'], message: string, hint?: string): DoctorCheck {
  return hint ? { name, status, message, hint } : { name, status, message };
}

export async function runDoctor(options: DoctorOptions): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
  checks.push(major > 20 || (major === 20 && minor >= 19) ? check('node', 'ok', `Node.js ${process.versions.node}`) : check('node', 'fail', `Node.js ${process.versions.node} is too old`, 'Install Node.js 20.19 or newer (22 LTS recommended).'));

  const { file: configFile, legacy } = resolveConfigFile(options.root, options.configFile);
  let config: StoryOpsConfig | undefined;
  let workspace = resolveWorkspace(options.root);
  try {
    const loaded = await loadConfig(configFile);
    config = loaded.config;
    workspace = workspaceFor(options.root, config, configFile);
    checks.push(check('config', legacy ? 'warn' : 'ok', `${path.relative(options.root, configFile) || configFile} is valid (${config.projects.length} repository(ies), ${Object.keys(config.author.profiles).length} author profile(s))`, legacy ? 'Run `storyops migrate` to create storyops.config.json.' : undefined));
    for (const w of loaded.warnings) checks.push(check('config.deprecated', 'warn', w));
    if (config.author.name === 'Your Name') checks.push(check('config.author', 'warn', 'author.name is still the placeholder', 'Set author.name and author.profiles in storyops.config.json.'));
    for (const project of config.projects) {
      const p = project.path ? path.resolve(options.root, project.path) : undefined;
      if (!p) checks.push(check(`repo:${project.id}`, 'warn', 'no path configured', 'Set projects[].path to the repository to inspect.'));
      else if (!pathExists(p)) checks.push(check(`repo:${project.id}`, 'fail', `path does not exist: ${p}`));
      else checks.push(check(`repo:${project.id}`, 'ok', p));
    }
  } catch (error) {
    checks.push(check('config', 'fail', errorMessage(error), 'Run `storyops init` or fix the reported fields.'));
  }

  if (pathExists(path.join(options.root, '.editorial')) && !pathExists(workspace.dbFile)) {
    checks.push(check('legacy-workspace', 'warn', 'a v2 .editorial/ workspace exists but no StoryOps database yet', 'Run `storyops migrate` (nothing is deleted).'));
  }

  const latest = loadMigrations().at(-1)?.version ?? 0;
  if (!pathExists(workspace.dbFile)) checks.push(check('database', 'warn', `${path.relative(options.root, workspace.dbFile)} does not exist yet`, 'Created automatically by the first research/author/repo command, or by `storyops init`.'));
  else {
    try {
      const { db } = await openDatabase(workspace.dbFile, { readOnly: true });
      const version = db.version();
      db.close();
      checks.push(version === latest ? check('database', 'ok', `schema v${version} (latest)`) : version < latest ? check('database', 'warn', `schema v${version}; v${latest} available`, 'The next command migrates it automatically (a backup is written to .storyops/backups/).') : check('database', 'fail', `schema v${version} is newer than this StoryOps (v${latest})`, 'Upgrade StoryOps.'));
    } catch (error) {
      checks.push(check('database', 'fail', errorMessage(error)));
    }
  }

  const git = await gitAvailable();
  checks.push(git ? check('git', 'ok', git) : check('git', 'fail', 'git not found on PATH', 'Install git; repository intelligence needs it.'));

  for (const dir of [workspace.dataDir, workspace.topicsDir, workspace.reviewsDir]) {
    if (!pathExists(dir)) checks.push(check(`dir:${path.basename(dir)}`, 'warn', `${dir} does not exist yet`, 'Run `storyops init`.'));
    else {
      try {
        await access(dir, constants.W_OK);
        checks.push(check(`dir:${path.basename(dir)}`, 'ok', `${dir} is writable`));
      } catch {
        checks.push(check(`dir:${path.basename(dir)}`, 'fail', `${dir} is not writable`));
      }
    }
  }

  const gitignore = path.join(options.root, '.gitignore');
  if (pathExists(gitignore)) {
    const content = await readFile(gitignore, 'utf8');
    const missing = ['.env', '.storyops/cache/'].filter((line) => !content.split(/\r?\n/).some((l) => l.trim() === line || l.trim() === line.replace(/\/$/, '')));
    checks.push(missing.length ? check('gitignore', 'warn', `.gitignore does not list: ${missing.join(', ')}`, 'Run `storyops init` to add recommended entries.') : check('gitignore', 'ok', 'secrets and caches are ignored'));
  } else checks.push(check('gitignore', 'warn', 'no .gitignore in the workspace', 'Run `storyops init` to create one with recommended entries.'));

  const proxy = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy'].find((k) => process.env[k]);
  checks.push(check('network', 'ok', proxy ? `proxy variable ${proxy} is set (value not shown); Node's built-in fetch may ignore proxy variables unless configured (e.g. NODE_USE_ENV_PROXY=1 on recent Node versions)` : 'no proxy variables set; live research uses direct HTTPS'));

  for (const module of createDefaultRegistry().list()) {
    const s = module.strategy;
    const enabled = config?.platforms[s.id]?.enabled !== false;
    checks.push(check(`platform:${s.id}`, 'ok', `strategy ${s.version}; live research: ${s.research.liveResearch}; author history: ${s.research.authorHistory}; import: ${s.research.importSupported ? 'yes' : 'no'}${enabled ? '' : ' (disabled in config)'}`));
  }

  try {
    const catalog = await loadProfileCatalog({ workspaceDir: workspace.reviewProfilesDir });
    const errors = catalog.issues.filter((i) => i.severity === 'error');
    checks.push(errors.length ? check('review-profiles', 'fail', errors.map((e) => `${path.basename(e.file)}: ${e.message}`).join('; ')) : check('review-profiles', 'ok', `${catalog.ids().length} review profile(s): ${catalog.ids().join(', ')}`));
  } catch (error) {
    checks.push(check('review-profiles', 'fail', errorMessage(error)));
  }

  try {
    const reports = await validateSkillsDir(path.join(packageRoot(), 'skills'));
    const errors = reports.flatMap((r) => r.issues.filter((i) => i.severity === 'error').map((i) => `${path.basename(r.dir)}: ${i.message}`));
    checks.push(errors.length ? check('skills', 'fail', errors.join('; ')) : check('skills', 'ok', `${reports.length} Agent Skill(s) valid: ${reports.map((r) => r.name).join(', ')}`));
  } catch (error) {
    checks.push(check('skills', 'warn', `could not validate bundled skills: ${errorMessage(error)}`));
  }

  checks.push(check('integrations', 'ok', `no paid AI/embedding APIs are required; none configured. ${LEGACY_CONFIG_FILE} is read only as a legacy fallback.`));
  return checks;
}
