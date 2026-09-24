import path from 'node:path';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parseFrontmatter } from '../src/shared/frontmatter.js';
import { installSkills, skillTargetDir } from '../src/skills/install.js';
import { validateSkill, validateSkillsDir } from '../src/skills/validate.js';
import { ROOT, tempDir } from './helpers.js';

describe('bundled Agent Skills', () => {
  it('are valid per the Agent Skills specification', async () => {
    const reports = await validateSkillsDir(path.join(ROOT, 'skills'));
    expect(reports.map((r) => r.name)).toEqual(['editorial-author', 'editorial-research', 'product-screenshots']);
    for (const r of reports) expect(r.issues).toEqual([]);
  });

  it('keep SKILL.md compact and use only spec frontmatter fields', async () => {
    for (const name of ['editorial-author', 'editorial-research', 'product-screenshots']) {
      const src = await readFile(path.join(ROOT, 'skills', name, 'SKILL.md'), 'utf8');
      const doc = parseFrontmatter(src);
      expect(Object.keys(doc.data).sort()).toEqual(['compatibility', 'description', 'license', 'metadata', 'name']);
      expect(doc.body.split('\n').length).toBeLessThan(200);
      expect(src).not.toMatch(/~\/\.claude|\.claude\/skills/); // no client-specific paths inside skill logic
    }
  });

  it('detects invalid skills', async () => {
    const tmp = await tempDir();
    try {
      const dir = path.join(tmp.dir, 'My-Skill');
      await mkdir(dir);
      await writeFile(path.join(dir, 'SKILL.md'), '---\nname: My-Skill\ndescription: ""\nfoo: bar\n---\nSee [x](references/missing.md)\n');
      const r = await validateSkill(dir);
      const messages = r.issues.map((i) => i.message).join('\n');
      expect(messages).toMatch(/lowercase/);
      expect(messages).toMatch(/description is required/);
      expect(messages).toMatch(/"foo" is not part of the Agent Skills spec/);
      expect(messages).toMatch(/references\/missing\.md does not exist/);
    } finally {
      await tmp.cleanup();
    }
  });

  it('installs into an explicit target and refuses to overwrite without --force', async () => {
    const tmp = await tempDir();
    try {
      expect(skillTargetDir('claude', 'project', tmp.dir)).toBe(path.join(tmp.dir, '.claude', 'skills'));
      expect(skillTargetDir('codex', 'project', tmp.dir)).toBe(path.join(tmp.dir, '.agents', 'skills'));
      const target = path.join(tmp.dir, 'skills-out');
      const r = await installSkills(path.join(ROOT, 'skills'), target);
      expect(r.installed).toEqual(expect.arrayContaining(['editorial-author', 'editorial-research', 'product-screenshots']));
      expect(await readdir(path.join(target, 'editorial-author', 'references'))).toContain('workflow.md');
      const again = await installSkills(path.join(ROOT, 'skills'), target);
      expect(again.installed).toEqual([]);
      expect(again.skipped).toHaveLength(3);
    } finally {
      await tmp.cleanup();
    }
  });
});
