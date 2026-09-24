import os from 'node:os';
import path from 'node:path';
import { cp, readdir, rm, symlink } from 'node:fs/promises';
import { EditorialError } from '../shared/errors.js';
import { ensureDir, pathExists } from '../shared/fs.js';

export type SkillAgent = 'claude' | 'codex';
export type SkillScope = 'project' | 'user';

export interface TargetEnvironment {
  /** Environment variables (defaults to process.env); only CODEX_HOME is read. */
  env?: Readonly<Record<string, string | undefined>>;
  /** Home directory (defaults to os.homedir()). */
  home?: string;
}

/**
 * Skill locations per client (verify against current client docs):
 * - Claude Code: project `<project>/.claude/skills/`, personal `~/.claude/skills/`.
 * - Codex: repository-local `<project>/.agents/skills/`; user-installed skills
 *   `$CODEX_HOME/skills/`, where CODEX_HOME defaults to `~/.codex`
 *   (so `~/.codex/skills/` unless CODEX_HOME is set).
 * Anything else: pass an explicit --target directory.
 */
export function skillTargetDir(agent: SkillAgent, scope: SkillScope, projectRoot: string, environment: TargetEnvironment = {}): string {
  const env = environment.env ?? process.env;
  const home = environment.home ?? os.homedir();
  if (agent === 'claude') return path.join(scope === 'user' ? home : path.resolve(projectRoot), '.claude', 'skills');
  if (scope === 'project') return path.join(path.resolve(projectRoot), '.agents', 'skills');
  const codexHome = env.CODEX_HOME?.trim();
  return path.join(codexHome ? path.resolve(codexHome) : path.join(home, '.codex'), 'skills');
}

/** Resolves the install destination: an explicit target always wins over --agent/--scope. */
export function resolveInstallTarget(options: { agent?: SkillAgent; scope?: SkillScope; target?: string; projectRoot: string } & TargetEnvironment): string {
  if (options.target) return path.resolve(options.projectRoot, options.target);
  if (!options.agent) throw new EditorialError('SKILLS_TARGET', 'Choose where to install: --agent claude|codex [--scope project|user] or --target <dir>');
  const environment: TargetEnvironment = {};
  if (options.env) environment.env = options.env;
  if (options.home) environment.home = options.home;
  return skillTargetDir(options.agent, options.scope ?? 'project', options.projectRoot, environment);
}

export interface InstallResult {
  installed: string[];
  skipped: Array<{ skill: string; reason: string }>;
  target: string;
}

export async function installSkills(sourceRoot: string, target: string, options: { link?: boolean; force?: boolean; only?: string[] } = {}): Promise<InstallResult> {
  if (!pathExists(sourceRoot)) throw new EditorialError('SKILLS_SOURCE', `Skills directory not found: ${sourceRoot}`);
  await ensureDir(target);
  const result: InstallResult = { installed: [], skipped: [], target };
  const skills = (await readdir(sourceRoot, { withFileTypes: true })).filter((e) => e.isDirectory() && (!options.only || options.only.includes(e.name)));
  for (const skill of skills) {
    const src = path.join(sourceRoot, skill.name);
    const dest = path.join(target, skill.name);
    if (pathExists(dest)) {
      if (!options.force) {
        result.skipped.push({ skill: skill.name, reason: `${dest} exists (use --force to replace)` });
        continue;
      }
      await rm(dest, { recursive: true, force: true });
    }
    if (options.link) await symlink(src, dest, 'dir');
    else await cp(src, dest, { recursive: true });
    result.installed.push(skill.name);
  }
  return result;
}
