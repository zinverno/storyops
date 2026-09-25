import path from 'node:path';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { ROOT } from './helpers.js';

const skill = (name: string) => readFile(path.join(ROOT, 'skills', name, 'SKILL.md'), 'utf8');

describe('Agent Skills: editorial layer', () => {
  it('editorial-author encodes the core rule, the new priority model and the editorial workflow', async () => {
    const src = await skill('editorial-author');
    expect(src).toContain('Never draft final prose directly from the canonical story, evidence map or\ntechnical brief. Build an editorial direction and an author-voice narrative\nplan first.');
    expect(src).toMatch(/FACTUAL TRUTH > EXPLICIT USER MATERIAL AND INSTRUCTIONS > AUTHOR VOICE\n {2}> ARTICLE STYLE PRESET > NARRATIVE CONTINUITY > PLATFORM STRATEGY > CURRENT TREND PATTERNS/);
    expect(src).toContain('DO NOT USE > VERBATIM / MUST USE > SHOULD USE > MAY USE > BACKGROUND ONLY');
    for (const step of ['input init', 'editorial plan', 'editorial validate', 'voice-sample.md', 'editorial audit']) expect(src).toContain(step);
  });

  it('ships every editorial reference', () => {
    for (const ref of ['author-input', 'style-presets', 'pattern-transfer', 'editorial-direction', 'voice-plan', 'drafting', 'editorial-audit']) {
      expect(existsSync(path.join(ROOT, 'skills/editorial-author/references', `${ref}.md`))).toBe(true);
    }
  });

  it('editorial-research leads to pattern transfer without deciding prose', async () => {
    const src = await skill('editorial-research');
    expect(src).toContain('observation → strength / provenance → apply | adapt | skip → article-specific consequence');
    expect(src).toMatch(/does not decide the prose/);
  });
});
