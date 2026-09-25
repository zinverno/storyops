import path from 'node:path';
import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDefaultRegistry, PlatformRegistry } from '../platforms/registry.js';
import { habrPlatform } from '../platforms/habr/index.js';
import { loadConfig } from '../src/config/load.js';
import { runEditorialDemo, type EditorialDemoResult } from '../src/demo/editorial.js';
import { runDemo, type DemoResult } from '../src/demo/run.js';
import { itemsByPriority } from '../src/editorial/author-input.js';
import { directionSchema } from '../src/editorial/direction.js';
import { voicePlanSchema } from '../src/editorial/voice-plan.js';
import { fixedClock } from '../src/shared/clock.js';
import { silentLogger } from '../src/shared/logger.js';
import { resolveWorkspace } from '../src/shared/workspace.js';
import type { AppContext } from '../src/workflow/context.js';
import { editorialPlanWorkflow, editorialValidateWorkflow, resolveEditorialDir } from '../src/workflow/editorial.js';
import { repurposeWorkflow } from '../src/workflow/story.js';
import { NOW_ISO, tempDir } from './helpers.js';

describe('offline editorial end-to-end scenario', () => {
  let demo: DemoResult;
  let result: EditorialDemoResult;
  let cleanup: () => Promise<void>;
  let v1Story: string;
  let v1Telegram: string;
  let ctx: AppContext;
  const errors = (r: { issues: Array<{ severity: string; message: string }> }) => r.issues.filter((i) => i.severity === 'error').map((i) => i.message);

  beforeAll(async () => {
    const tmp = await tempDir('editorial-e2e-');
    cleanup = tmp.cleanup;
    demo = await runDemo(tmp.dir);
    v1Story = await readFile(demo.storyFile, 'utf8');
    v1Telegram = await readFile(demo.outputs.telegram!, 'utf8');
    const workspace = resolveWorkspace(tmp.dir);
    ctx = { workspace, config: await loadConfig(workspace.configFile), registry: createDefaultRegistry(), clock: fixedClock(NOW_ISO), logger: silentLogger };
    result = await runEditorialDemo(tmp.dir);
  }, 120_000);
  afterAll(async () => cleanup?.());

  it('a v1 workspace without editorial files stays valid and says that no plan exists', () => {
    expect(v1Telegram).toMatch(/No editorial plan exists for telegram/);
    expect(demo.briefs.habr!.readiness.readyForDrafting).toBe(true);
  });

  it('never rewrites the canonical story', async () => {
    expect(await readFile(demo.storyFile, 'utf8')).toBe(v1Story);
  });

  it('parses the author input: VERBATIM, MUST, SHOULD, MAY, DO NOT USE and raw notes', () => {
    const by = itemsByPriority(result.authorInput);
    expect(by.verbatim.map((i) => i.text)).toEqual(['Finding перестал быть просто строкой в отчёте.']);
    expect(by.must).toHaveLength(1);
    expect(by.should).toHaveLength(1);
    expect(by.may.map((i) => i.text)[0]).toMatch(/профессиональная амнезия/);
    expect(by.avoid.map((i) => i.text)).toEqual(['революционный']);
    expect(by.unclassified[0]!.text).toMatch(/два разных смысла/);
  });

  it('plans engineering-story on Habr: early conflict applied, author phrase placed, conflict → model → architecture', async () => {
    const dir = await resolveEditorialDir(path.dirname(result.storyFile), 'habr');
    const direction = directionSchema.parse(JSON.parse(await readFile(path.join(dir, 'direction.json'), 'utf8')));
    const vp = voicePlanSchema.parse(JSON.parse(await readFile(path.join(dir, 'voice-plan.json'), 'utf8')));
    expect(direction.style).toMatchObject({ id: 'engineering-story', chosenBy: 'user' });
    expect(direction.openingApproach).toMatch(/noisy report/);
    const pt = JSON.parse(await readFile(path.join(dir, 'pattern-transfer.json'), 'utf8')) as { items: Array<{ id: string; decision: string; placement: string[] }> };
    expect(pt.items.find((i) => i.id === 'body-conflict-early')).toMatchObject({ decision: 'apply', placement: ['opening', 'beat:report-noise'] });
    expect(pt.items.find((i) => i.id === 'body-measurements')?.decision).toBe('skip');
    expect(vp.narrativeMovement.map((b) => b.id)).toEqual(['report-noise', 'why-overwrite-seemed-fine', 'finding-gets-state', 'storage', 'health-per-folder', 'audit-becomes-pipeline', 'open-question']);
    expect(vp.narrativeMovement[0]!.patternIds).toContain('body-conflict-early');
    const verbatim = vp.authorMaterial.find((m) => m.priority === 'verbatim')!;
    expect(verbatim).toMatchObject({ status: 'planned', beatId: 'finding-gets-state' });
  });

  it('validation blocks the scaffold and passes once decisions are recorded', () => {
    expect(result.validationBefore.ready).toBe(false);
    expect(errors(result.validationBefore).some((m) => /decision pending/.test(m))).toBe(true);
    expect(errors(result.validation)).toEqual([]);
    expect(result.validation.ready).toBe(true);
  });

  it('audit: VERBATIM detected, MUST mapped, SHOULD status shown, patterns placed', () => {
    expect(result.auditBeforeMapping.summary.must.unmapped).toBe(1);
    expect(result.auditBeforeMapping.summary.errors).toBeGreaterThan(0);
    const a = result.audit;
    expect(a.summary.errors).toBe(0);
    expect(a.summary.verbatim).toEqual({ total: 1, incorporated: 1 });
    expect(a.summary.must).toEqual({ total: 1, incorporated: 1, omitted: 0, unmapped: 0 });
    expect(a.summary.should).toEqual({ total: 1, incorporated: 0, omitted: 1, unmapped: 0 });
    expect(a.summary.avoid).toEqual({ total: 1, violations: 0 });
    const conflict = a.patterns.find((p) => p.patternId === 'body-conflict-early')!;
    expect(conflict).toMatchObject({ status: 'incorporated', result: 'pass', expectedPlacement: ['opening', 'beat:report-noise'], location: { paragraphs: [1, 2] } });
    expect(a.material.find((m) => m.priority === 'verbatim')?.detection).toBe('exact');
  });

  it('audit rejects forbidden wording and a reworded VERBATIM phrase', () => {
    const msgs = errors(result.negativeAudit);
    expect(msgs.some((m) => /DO NOT USE "революционный" appears at line/.test(m))).toBe(true);
    expect(msgs.some((m) => /VERBATIM phrase not found exactly/.test(m))).toBe(true);
  });

  it('writes the demo summary and the audit view', async () => {
    const summary = await readFile(path.join(demo.root, 'DEMO.md'), 'utf8');
    expect(summary).toMatch(/## Editorial layer \(Phase 2\)/);
    const auditMd = await readFile(path.join(path.dirname(result.storyFile), 'editorial', 'audit.md'), 'utf8');
    expect(auditMd).toMatch(/VERBATIM {5}✓ 1\/1 incorporated exactly/);
    expect(auditMd).toMatch(/## Paragraph index/);
  });

  it('plans another platform in its own directory without touching the Habr plan', async () => {
    const habrDir = await resolveEditorialDir(path.dirname(result.storyFile), 'habr');
    const before = await readFile(path.join(habrDir, 'direction.json'), 'utf8');
    const r = await editorialPlanWorkflow(ctx, result.storyFile, 'telegram', { style: 'dev-diary' });
    expect(r.files.dir).toBe(path.join(path.dirname(result.storyFile), 'editorial', 'telegram'));
    expect(r.plan.patternTransfer.items).toEqual([]);
    expect(r.plan.voicePlan.calibration.required).toBe(false);
    expect(await readFile(path.join(habrDir, 'direction.json'), 'utf8')).toBe(before);
    const rep = await repurposeWorkflow(ctx, result.storyFile, 'telegram', { type: 'short-project-update' });
    expect(rep.editorialPlan.planned).toBe(true);
    expect(await readFile(rep.output, 'utf8')).toMatch(/Editorial plan: editorial\/telegram\/direction\.md/);
  });

  it('platform strategy version changes are reported as drift', async () => {
    const bumped = new PlatformRegistry().register({ ...habrPlatform, strategy: { ...habrPlatform.strategy, version: '1.1.0' } });
    for (const m of createDefaultRegistry().list()) if (m.strategy.id !== 'habr') bumped.register(m);
    const r = await editorialValidateWorkflow({ ...ctx, registry: bumped }, result.storyFile, 'habr');
    expect(errors(r)).toContain('platform strategy habr changed version 1.0.0 → 1.1.0 since voice plan was created. Run `editorial plan` to refresh, then review.');
  });

  it('a modified research snapshot is drift', async () => {
    const file = path.join(demo.root, '.editorial/research/2026-09-24/habr.json');
    const original = await readFile(file, 'utf8');
    await writeFile(file, original.replace('"status": "cache"', '"status": "partial"'));
    try {
      const r = await editorialValidateWorkflow(ctx, result.storyFile, 'habr');
      expect(errors(r)).toContain('research snapshot .editorial/research/2026-09-24/habr.json was modified since pattern transfer was created. Run `editorial plan` to refresh, then review.');
    } finally {
      await writeFile(file, original);
    }
    expect((await editorialValidateWorkflow(ctx, result.storyFile, 'habr')).ready).toBe(true);
  });

  it('trend research can never be cited as evidence for a claim', async () => {
    const original = await readFile(result.storyFile, 'utf8');
    const story = JSON.parse(original) as { claims: Array<{ id: string; evidence: string[] }> };
    story.claims[0]!.evidence.push('research:habr:body-conflict-early');
    await writeFile(result.storyFile, JSON.stringify(story, null, 2));
    try {
      const r = await editorialValidateWorkflow(ctx, result.storyFile, 'habr');
      expect(errors(r).some((m) => /Trend research is never evidence for a factual claim/.test(m))).toBe(true);
    } finally {
      await writeFile(result.storyFile, original);
    }
  });

  it('editing author-input.md makes the plan stale until it is refreshed and reviewed', async () => {
    const input = path.join(path.dirname(result.storyFile), 'author-input.md');
    await appendFile(input, '\n- Ещё одна мысль на потом.\n');
    const stale = await editorialValidateWorkflow(ctx, result.storyFile, 'habr');
    expect(errors(stale)).toContain('author input (author-input.md) changed since voice plan was created. Run `editorial plan` to refresh, then review.');

    const refreshed = await editorialPlanWorkflow(ctx, result.storyFile, 'habr');
    expect(refreshed.refreshed).toBe(true);
    expect(refreshed.plan.direction.style.id).toBe('engineering-story');
    expect(refreshed.plan.direction.readerPromise).toMatch(/forgot everything/);
    expect(refreshed.reviewRequired.some((m) => /author input \(author-input\.md\) changed since voice plan was created/.test(m))).toBe(true);
    const review = await editorialValidateWorkflow(ctx, result.storyFile, 'habr');
    expect(errors(review).some((m) => /^Review required: author input/.test(m))).toBe(true);

    for (const file of ['direction.json', 'pattern-transfer.json', 'voice-plan.json']) {
      const p = path.join(refreshed.files.dir, file);
      const data = JSON.parse(await readFile(p, 'utf8')) as { reviewRequired: string[] };
      data.reviewRequired = [];
      await writeFile(p, JSON.stringify(data, null, 2));
    }
    const reviewed = await editorialValidateWorkflow(ctx, result.storyFile, 'habr');
    expect(errors(reviewed)).toEqual([]);
  });
});
