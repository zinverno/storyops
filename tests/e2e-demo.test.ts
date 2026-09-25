import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runDemo, type DemoResult } from '../src/demo/run.js';
import { sha256 } from '../src/shared/hash.js';
import { FIXTURES, tempDir } from './helpers.js';

describe('offline intelligence demo (end to end)', () => {
  let result: DemoResult;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    const tmp = await tempDir('storyops-demo-');
    cleanup = tmp.cleanup;
    result = await runDemo(tmp.dir);
  }, 120_000);
  afterAll(async () => cleanup?.());

  it('repository: a new reconciliation subsystem and a bug fix', () => {
    expect(result.events.find((e) => e.type === 'new-subsystem' && e.subsystem === 'src/reconciliation')?.evidenceStrength).toBe('strong');
    expect(result.events.some((e) => e.type === 'bug-fix' && e.subsystem === 'src/reconciliation')).toBe(true);
  });

  it('author archive: reconciliation not covered; the old architecture deeply covered', () => {
    const by = (id: string) => result.coverage.find((c) => c.topicId === id)!;
    expect(by('reconciliation').level).toBe('not-covered');
    expect(by('audit').level).toBe('deeply-covered');
    expect(by('finding-lifecycle').level).toBe('mentioned'); // a brief Telegram note
  });

  it('platform: the generic AI framing is highly saturated and rising; the related database theme is moderately active', () => {
    expect(result.aiSaturation.state).toBe('highly-saturated');
    expect(result.aiTrend.direction).toBe('rising');
    expect(result.aiTrend.basis).toBe('research-runs');
    const reconciliation = result.opportunities.candidates.find((c) => c.id === 'reconciliation')!;
    expect(reconciliation.platform?.primary).toMatchObject({ topicId: 'databases', relation: 'related', state: 'active', activity: 'medium' });
  });

  it('opportunities: reconciliation is novel with no overlap; the generic AI plugin angle is crowded; no ranking', () => {
    const reconciliation = result.opportunities.candidates.find((c) => c.id === 'reconciliation')!;
    expect(reconciliation.dimensions.repositoryNovelty.level).toBe('high');
    expect(reconciliation.dimensions.authorOverlap.level).toBe('none');
    expect(reconciliation.quadrant).toBe('active opportunity');
    expect(result.opportunities.candidates.find((c) => c.id === 'audit')!.dimensions.authorOverlap.level).toBe('high');
    const generic = result.comparison[1]!;
    expect(generic.dimensions.saturation.state).toBe('highly-saturated');
    expect(generic.dimensions.repositoryNovelty.level).toBe('low');
    expect(generic.quadrant).toBe('crowded/repetitive');
    expect(result.opportunities.notice).toMatch(/does not choose topics/);
    expect(result.dossier.questions.length).toBeGreaterThan(0);
  });

  it('review: flags the unsupported performance claim, the duplicated paragraph and the awkward phrase', () => {
    const f = result.review.findings;
    const claim = f.find((x) => x.evidence?.status === 'unsupported')!;
    expect(claim.excerpt).toMatch(/в 3 раза быстрее/);
    expect(f.find((x) => x.rule === 'near-duplicate-paragraphs')).toBeDefined();
    expect(f.find((x) => x.rule === 'bureaucratic-enable')).toMatchObject({ excerpt: 'Данная система позволяет осуществлять анализ', alternative: 'Система анализирует' });
    expect(f.find((x) => x.category === 'logic')?.rule).toBe('absolute-vs-qualified');
  });

  it('the article file is byte-identical to the human-written fixture', async () => {
    expect(result.article.hashAfter).toBe(result.article.hashBefore);
    expect(sha256(await readFile(result.article.file))).toBe(sha256(await readFile(path.join(FIXTURES, 'review/article.md'))));
  });

  it('generates no article or draft artifact', () => {
    for (const f of result.writtenFiles) {
      expect(f).not.toMatch(/(^|\/)(article|draft)[^/]*\.md$/i);
      expect(f).not.toMatch(/(^|\/)(outputs|drafts|articles)\//);
      expect(f).not.toMatch(/story\.json$|voice-plan|brief\.md/);
    }
    expect(result.writtenFiles).toEqual(expect.arrayContaining(['topics/opportunities.md', 'topics/opportunities.json', 'topics/reconciliation/dossier.md', 'reviews/article-2026-09-24/review.json', 'reviews/article-2026-09-24/review.md', '.storyops/storyops.db']));
  });

  it('writes a readable summary', async () => {
    const summary = await readFile(result.summaryFile, 'utf8');
    expect(summary).toMatch(/StoryOps analyses; the human writes/);
    expect(summary).toMatch(/article\.md unchanged/);
    expect(summary).toMatch(/No article or draft was generated/);
  });
});
