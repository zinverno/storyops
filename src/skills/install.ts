import os from 'node:os';
import path from 'node:path';
import { cp, readdir, rm, symlink } from 'node:fs/promises';
import { EditorialError } from '../shared/errors.js';
import { ensureDir, pathExists } from '../shared/fs.js';

/**
 * Skill discovery locations, as documented by each client (verify against current docs):
 * - Claude Code: project `.claude/skills/`, personal `~/.claude/skills/`
 * - Codex (and other clients reading the shared convention): project `.agents/skills/`, user `~/.agents/skills/`
 * Anything else: pass an explicit --target directory.
 */
export function skillTargetDir(agent: 'claude' | 'codex', scope: 'project' | 'user', projectRoot: string): string {
  const base = scope === 'user' ? os.homedir() : projectRoot;
  return path.join(base, agent === 'claude' ? '.claude' : '.agents', 'skills');
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
