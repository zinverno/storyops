import os from 'node:os';
import path from 'node:path';
import { cp, readdir, rm, symlink } from 'node:fs/promises';
import { StoryOpsError } from '../shared/errors.js';
import { ensureDir, pathExists } from '../shared/fs.js';

export type SkillAgent = 'claude' | 'codex';
export type SkillScope = 'project' | 'user';

export interface TargetEnvironment {
  /** Home directory (defaults to os.homedir()). */
  home?: string;
}

/**
 * Default skill locations per client, following each client's current
 * discovery documentation:
 * - Claude Code: project `<project>/.claude/skills/`, personal `~/.claude/skills/`.
 * - Codex: repository `<project>/.agents/skills/` (Codex scans `.agents/skills`
 *   from the working directory up to the repository root), user
 *   `$HOME/.agents/skills/`. (Codex also reads admin skills from
 *   `/etc/codex/skills`; StoryOps never installs there.)
 *
 * `$CODEX_HOME/skills` (default `~/.codex/skills`) is where Codex's built-in
 * `skill-installer` puts skills. It is NOT a StoryOps default and CODEX_HOME
 * does not affect these targets; use `--target "$CODEX_HOME/skills"` explicitly
 * for compatibility. StoryOps never installs into more than one location.
 */
export function skillTargetDir(agent: SkillAgent, scope: SkillScope, projectRoot: string, environment: TargetEnvironment = {}): string {
  const home = environment.home ?? os.homedir();
  const base = scope === 'user' ? home : path.resolve(projectRoot);
  return path.join(base, agent === 'claude' ? '.claude' : '.agents', 'skills');
}

/** Resolves the install destination: an explicit target always wins over --agent/--scope. */
export function resolveInstallTarget(options: { agent?: SkillAgent; scope?: SkillScope; target?: string; projectRoot: string } & TargetEnvironment): string {
  if (options.target) return path.resolve(options.projectRoot, options.target);
  if (!options.agent) throw new StoryOpsError('SKILLS_TARGET', 'Choose where to install: --agent claude|codex [--scope project|user] or --target <dir>');
  return skillTargetDir(options.agent, options.scope ?? 'project', options.projectRoot, options.home ? { home: options.home } : {});
}

export interface InstallResult {
  installed: string[];
  skipped: Array<{ skill: string; reason: string }>;
  target: string;
}

export async function installSkills(sourceRoot: string, target: string, options: { link?: boolean; force?: boolean; only?: string[] } = {}): Promise<InstallResult> {
  if (!pathExists(sourceRoot)) throw new StoryOpsError('SKILLS_SOURCE', `Skills directory not found: ${sourceRoot}`);
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
