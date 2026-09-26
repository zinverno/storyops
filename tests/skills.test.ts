import path from 'node:path';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parseFrontmatter } from '../src/shared/frontmatter.js';
import { installSkills, resolveInstallTarget, skillTargetDir } from '../src/skills/install.js';
import { validateSkill, validateSkillsDir } from '../src/skills/validate.js';
import { ROOT, tempDir } from './helpers.js';

const SKILLS = ['storyops-opportunity', 'storyops-research', 'storyops-review'];

describe('bundled Agent Skills', () => {
  it('are valid per the Agent Skills specification', async () => {
    const reports = await validateSkillsDir(path.join(ROOT, 'skills'));
    expect(reports.map((r) => r.name)).toEqual(SKILLS);
    for (const r of reports) expect(r.issues).toEqual([]);
  });

  it('keep SKILL.md compact and use only spec frontmatter fields', async () => {
    for (const name of SKILLS) {
      const src = await readFile(path.join(ROOT, 'skills', name, 'SKILL.md'), 'utf8');
      const doc = parseFrontmatter(src);
      expect(Object.keys(doc.data).sort()).toEqual(['compatibility', 'description', 'license', 'metadata', 'name']);
      expect(doc.body.split('\n').length).toBeLessThan(200);
      expect(src).not.toMatch(/~\/\.claude|\.claude\/skills/); // no client-specific paths inside skill logic
    }
  });

  it('encode the product principle: StoryOps analyses, the human writes', async () => {
    const REFUSAL = 'I can research the topic, show evidence and review a draft you write.';
    for (const name of ['storyops-research', 'storyops-opportunity', 'storyops-review']) {
      const src = await readFile(path.join(ROOT, 'skills', name, 'SKILL.md'), 'utf8');
      expect(src, name).toContain(REFUSAL);
      expect(src, name).toMatch(/The human writes|the author writes/i);
      // No generation workflow survives in any skill.
      expect(src, name).not.toMatch(/editorial-kit|repurpose\s+\S+\.json|story create|voice plan|draft workspace|editorial plan/i);
    }
    const review = await readFile(path.join(ROOT, 'skills', 'storyops-review', 'SKILL.md'), 'utf8');
    expect(review).toMatch(/Never[\s\S]*rewrite the article/);
    expect(review).toMatch(/Possible issue/);
    // The imperative form appears only as the forbidden example.
    expect(review.match(/You must rewrite/g)).toHaveLength(1);
    expect(review).toMatch(/Never "You must rewrite this as"/);
    const opportunity = await readFile(path.join(ROOT, 'skills', 'storyops-opportunity', 'SKILL.md'), 'utf8');
    expect(opportunity).toMatch(/never ranks topics/i);
    expect(opportunity).toMatch(/Never: "best topic"/);
    const research = await readFile(path.join(ROOT, 'skills', 'storyops-research', 'SKILL.md'), 'utf8');
    expect(research).toMatch(/Observed pattern \/ Evidence \/ Strength \/ Possible relevance/);
    for (const name of SKILLS) {
      for (const file of await readdir(path.join(ROOT, 'skills', name, 'references'))) {
        const ref = await readFile(path.join(ROOT, 'skills', name, 'references', file), 'utf8');
        expect(ref, `${name}/${file}`).not.toMatch(/editorial-kit|canonical story|story\.json|voice plan|brief\.md/i);
      }
    }
  });

  it('are analysis-only: no screenshot or publication-asset skill is bundled', async () => {
    expect((await readdir(path.join(ROOT, 'skills'))).sort()).toEqual(SKILLS);
    for (const name of SKILLS) {
      const src = await readFile(path.join(ROOT, 'skills', name, 'SKILL.md'), 'utf8');
      expect(src, name).not.toMatch(/screenshots capture|product-screenshots|playwright/i);
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
      const target = path.join(tmp.dir, 'skills-out');
      const r = await installSkills(path.join(ROOT, 'skills'), target);
      expect(r.installed).toEqual(expect.arrayContaining(SKILLS));
      expect(await readdir(path.join(target, 'storyops-review', 'references'))).toContain('boundaries.md');
      const again = await installSkills(path.join(ROOT, 'skills'), target);
      expect(again.installed).toEqual([]);
      expect(again.skipped).toHaveLength(SKILLS.length);
    } finally {
      await tmp.cleanup();
    }
  });

  describe('install destinations', () => {
    const project = '/work/project';
    const home = '/home/tester';

    it('Codex project scope → <project>/.agents/skills', () => {
      expect(skillTargetDir('codex', 'project', project, { home })).toBe('/work/project/.agents/skills');
      expect(resolveInstallTarget({ agent: 'codex', scope: 'project', projectRoot: project, home })).toBe('/work/project/.agents/skills');
    });

    it('Codex user scope → $HOME/.agents/skills', () => {
      expect(skillTargetDir('codex', 'user', project, { home })).toBe('/home/tester/.agents/skills');
      expect(resolveInstallTarget({ agent: 'codex', scope: 'user', projectRoot: project, home })).toBe('/home/tester/.agents/skills');
    });

    it('CODEX_HOME does not change the normal StoryOps user target', () => {
      const previous = process.env.CODEX_HOME;
      process.env.CODEX_HOME = '/opt/codex-home';
      try {
        expect(skillTargetDir('codex', 'user', project, { home })).toBe('/home/tester/.agents/skills');
        expect(resolveInstallTarget({ agent: 'codex', scope: 'user', projectRoot: project, home })).not.toContain('codex-home');
      } finally {
        if (previous === undefined) delete process.env.CODEX_HOME;
        else process.env.CODEX_HOME = previous;
      }
    });

    it('explicit --target "$CODEX_HOME/skills" still works for legacy skill-installer compatibility', async () => {
      const tmp = await tempDir();
      try {
        const codexHome = path.join(tmp.dir, 'codex-home');
        const target = resolveInstallTarget({ agent: 'codex', scope: 'user', target: `${codexHome}/skills`, projectRoot: project, home });
        expect(target).toBe(path.join(codexHome, 'skills'));
        const r = await installSkills(path.join(ROOT, 'skills'), target);
        expect(r.target).toBe(path.join(codexHome, 'skills'));
        expect((await readdir(path.join(codexHome, 'skills'))).sort()).toEqual(SKILLS);
        expect(resolveInstallTarget({ target: 'rel/skills', projectRoot: project })).toBe('/work/project/rel/skills');
      } finally {
        await tmp.cleanup();
      }
    });

    it('Claude paths are unchanged: <project>/.claude/skills and ~/.claude/skills', () => {
      expect(skillTargetDir('claude', 'project', project, { home })).toBe('/work/project/.claude/skills');
      expect(skillTargetDir('claude', 'user', project, { home })).toBe('/home/tester/.claude/skills');
    });

    it('requires an explicit destination', () => {
      expect(() => resolveInstallTarget({ projectRoot: project })).toThrow(/Choose where to install/);
    });
  });
});
