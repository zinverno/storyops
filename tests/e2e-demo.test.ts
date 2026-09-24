import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { runDemo, type DemoResult } from '../src/demo/run.js';
import { parseFrontmatter } from '../src/shared/frontmatter.js';
import { tempDir } from './helpers.js';

describe('offline end-to-end fixture scenario', () => {
  let result: DemoResult;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    const tmp = await tempDir('editorial-demo-');
    cleanup = tmp.cleanup;
    result = await runDemo(tmp.dir);
  }, 120_000);
  afterAll(async () => cleanup?.());

  it('knows what was already covered: project origin and original architecture', () => {
    const covered = result.summary.alreadyCovered.join('\n');
    expect(covered).toMatch(/project origin/);
    expect(covered).toMatch(/original architecture/);
    expect(covered).toMatch(/разовый аудит/);
  });

  it('finds architecture evolution and new, undiscussed subsystems as the narrative gap', () => {
    expect(result.gap.headline).toMatch(/Architecture evolved/);
    const arch = result.gap.gaps.find((g) => g.kind === 'architecture-evolution');
    expect(arch?.strength).toBe('strong');
    expect(arch?.title).toMatch(/audit → /);
    const subsystems = result.gap.gaps.filter((g) => g.kind === 'new-subsystem').map((g) => g.title);
    expect(subsystems.some((t) => t.includes('src/knowledge'))).toBe(true);
    expect(subsystems.some((t) => t.includes('src/health'))).toBe(true);
    expect(result.gap.gaps.some((g) => g.kind === 'migration')).toBe(true);
    expect(result.gap.gaps.some((g) => g.kind === 'removed-approach' && g.title.includes('src/audit'))).toBe(true);
  });

  it('flags the generic "AI in project" angle as saturated', () => {
    expect(result.genericCollision.saturatedAngles.some((a) => /AI/.test(a.label))).toBe(true);
    expect(result.genericCollision.summary.join(' ')).toMatch(/Saturated angle/);
  });

  it('reports the unique contribution as architecture evolution backed by code and tests', () => {
    expect(result.summary.uniqueContribution.join('\n')).toMatch(/Architecture evolved.*test file/s);
  });

  it('observes that higher-momentum articles expose the technical conflict early', () => {
    const ids = result.snapshot.observations.map((o) => o.id);
    expect(ids).toContain('body-conflict-early');
    expect(result.summary.trendObservations.length).toBeGreaterThan(0);
    expect(result.snapshot.sampleSize).toBe(11);
  });

  it('recommends packaging from continuity and the architecture limitation, not from zero', () => {
    const packaging = result.summary.recommendedPackaging.join('\n');
    expect(packaging).toMatch(/Do not reintroduce the project from zero/);
    expect(packaging).toMatch(/limitation of the previous architecture/);
    expect(packaging).toMatch(/\(advisory\).*\[trend-observation\]/);
  });

  it('derives every platform output from the same canonical story', async () => {
    expect(Object.keys(result.outputs).sort()).toEqual(['habr', 'linkedin', 'medium', 'telegram']);
    for (const [platform, file] of Object.entries(result.outputs)) {
      const doc = parseFrontmatter(await readFile(file, 'utf8'));
      expect(doc.data.platform).toBe(platform);
      expect(doc.data.story).toBe('notegarden-health-model');
      expect(doc.body).toContain('story.json');
    }
    const story = JSON.parse(await readFile(result.storyFile, 'utf8'));
    expect(story.outputs.map((o: { platform: string }) => o.platform).sort()).toEqual(['habr', 'linkedin', 'medium', 'telegram']);
  });

  it('maps every verified claim to repository evidence and is ready for drafting', () => {
    expect(result.evidence.issues.filter((i) => i.severity === 'error')).toEqual([]);
    const verified = result.evidence.claims.filter((c) => c.classification === 'verified-fact');
    expect(verified.length).toBeGreaterThan(0);
    expect(verified.every((c) => c.status === 'supported')).toBe(true);
    expect(result.briefs.habr!.readiness.readyForDrafting).toBe(true);
  });

  it('writes the human-readable demo summary and continuity artifacts', async () => {
    const summary = await readFile(result.summaryFile, 'utf8');
    expect(summary).toMatch(/## Narrative gap/);
    const continuity = await readFile(path.join(result.root, '.editorial/continuity.md'), 'utf8');
    expect(continuity).toMatch(/Continuity map/);
  });
});
