import path from 'node:path';
import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createDefaultRegistry } from '../../platforms/registry.js';
import { loadConfig } from '../config/load.js';
import type { EditorialConfig } from '../config/schema.js';
import { gitAvailable } from '../git/git.js';
import { resolveChromiumExecutable } from '../screenshots/browser.js';
import { errorMessage } from '../shared/errors.js';
import { pathExists } from '../shared/fs.js';
import { resolveWorkspace } from '../shared/workspace.js';
import { validateSkillsDir } from '../skills/validate.js';
import { packageRoot } from '../demo/paths.js';

export interface DoctorCheck {
  name: string;
  status: 'ok' | 'warn' | 'fail';
  message: string;
  hint?: string;
}

export interface DoctorOptions {
  root: string;
  configFile?: string;
  /** Actually launch the browser (slower, but proves screenshots work). */
  launchBrowser?: boolean;
}

function check(name: string, status: DoctorCheck['status'], message: string, hint?: string): DoctorCheck {
  return hint ? { name, status, message, hint } : { name, status, message };
}

export async function runDoctor(options: DoctorOptions): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
  checks.push(major > 20 || (major === 20 && minor >= 19) ? check('node', 'ok', `Node.js ${process.versions.node}`) : check('node', 'fail', `Node.js ${process.versions.node} is too old`, 'Install Node.js 20.19 or newer (22 LTS recommended).'));

  const workspace = resolveWorkspace(options.root, options.configFile ? { configFile: options.configFile } : {});
  let config: EditorialConfig | undefined;
  try {
    config = await loadConfig(workspace.configFile);
    checks.push(check('config', 'ok', `${path.relative(options.root, workspace.configFile) || workspace.configFile} is valid (${config.projects.length} project(s), ${Object.keys(config.author.profiles).length} author profile(s))`));
    if (config.author.name === 'Your Name') checks.push(check('config.author', 'warn', 'author.name is still the placeholder', 'Set author.name and author.profiles in editorial.config.json.'));
    for (const project of config.projects) {
      const p = project.path ? path.resolve(options.root, project.path) : undefined;
      if (!p) checks.push(check(`project:${project.id}`, 'warn', 'no path configured', 'Set projects[].path to the repository to inspect.'));
      else if (!pathExists(p)) checks.push(check(`project:${project.id}`, 'fail', `path does not exist: ${p}`));
      else checks.push(check(`project:${project.id}`, 'ok', p));
    }
  } catch (error) {
    checks.push(check('config', 'fail', errorMessage(error), 'Run `editorial-kit init` or fix the reported fields.'));
  }

  const git = await gitAvailable();
  checks.push(git ? check('git', 'ok', git) : check('git', 'fail', 'git not found on PATH', 'Install git; project history inspection needs it.'));

  try {
    const pw = await import('playwright');
    const exe = await resolveChromiumExecutable(config?.screenshots.browserExecutablePath);
    const bundled = pw.chromium.executablePath();
    const effective = exe ?? bundled;
    if (!pathExists(effective)) {
      checks.push(check('browser', 'warn', 'Playwright is installed but no Chromium executable was found', 'Run `npx playwright install chromium` or set EDITORIAL_CHROMIUM_PATH. Screenshots are optional for the rest of the toolkit.'));
    } else if (options.launchBrowser) {
      try {
        const browser = await pw.chromium.launch({ headless: true, ...(exe ? { executablePath: exe } : {}) });
        const version = browser.version();
        await browser.close();
        checks.push(check('browser', 'ok', `Chromium ${version} launched (${effective})`));
      } catch (error) {
        checks.push(check('browser', 'fail', `Chromium failed to launch: ${errorMessage(error).split('\n')[0]}`, 'Run `npx playwright install --with-deps chromium`.'));
      }
    } else checks.push(check('browser', 'ok', `Chromium executable found: ${effective} (use --browser to test a launch)`));
  } catch {
    checks.push(check('playwright', 'warn', 'playwright is not importable', 'Run `npm install`. Only screenshots need it.'));
  }

  const dirs = [workspace.editorialDir, workspace.articlesDir];
  for (const dir of dirs) {
    if (!pathExists(dir)) checks.push(check(`dir:${path.basename(dir)}`, 'warn', `${dir} does not exist yet`, 'Run `editorial-kit init`.'));
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
    const missing = ['.env', '.editorial/cache/'].filter((line) => !content.split(/\r?\n/).some((l) => l.trim() === line || l.trim() === line.replace(/\/$/, '')));
    checks.push(missing.length ? check('gitignore', 'warn', `.gitignore does not list: ${missing.join(', ')}`, 'Run `editorial-kit init` to add recommended entries.') : check('gitignore', 'ok', 'secrets and caches are ignored'));
  } else checks.push(check('gitignore', 'warn', 'no .gitignore in the workspace', 'Run `editorial-kit init` to create one with recommended entries.'));

  const proxy = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy'].find((k) => process.env[k]);
  checks.push(check('network', 'ok', proxy ? `proxy variable ${proxy} is set (value not shown); Node's built-in fetch may ignore proxy variables unless configured (e.g. NODE_USE_ENV_PROXY=1 on recent Node versions)` : 'no proxy variables set; live research uses direct HTTPS'));

  const registry = createDefaultRegistry();
  for (const module of registry.list()) {
    const s = module.strategy;
    const enabled = config?.platforms[s.id]?.enabled !== false;
    checks.push(check(`platform:${s.id}`, 'ok', `strategy ${s.version}; live research: ${s.research.liveResearch}; author history: ${s.research.authorHistory}; renderer: ${module.renderer ? 'custom' : 'default'}${enabled ? '' : ' (disabled in config)'}`));
  }

  try {
    const reports = await validateSkillsDir(path.join(packageRoot(), 'skills'));
    const errors = reports.flatMap((r) => r.issues.filter((i) => i.severity === 'error').map((i) => `${path.basename(r.dir)}: ${i.message}`));
    checks.push(errors.length ? check('skills', 'fail', errors.join('; ')) : check('skills', 'ok', `${reports.length} Agent Skill(s) valid: ${reports.map((r) => r.name).join(', ')}`));
  } catch (error) {
    checks.push(check('skills', 'warn', `could not validate bundled skills: ${errorMessage(error)}`));
  }

  checks.push(check('integrations', 'ok', 'no paid AI/embedding APIs are required; none configured'));
  return checks;
}
